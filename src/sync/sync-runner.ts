import type { ProductPage } from '../erp/erp-client.js';
import { ErpError } from '../erp/erp-error.js';
import type { ProductsRepository } from './products.repository.js';
import {
  decideStatus,
  type RunOutcome,
  type StatusDecision,
} from './run-status.js';
import {
  type FailedPage,
  FencedError,
  type SyncRunsRepository,
} from './sync-runs.repository.js';

/** Where pages come from: the ErpClient in production, a fake in tests. */
export interface ProductSource {
  fetchPage(
    page: number,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<ProductPage>;
}

export interface SyncLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface SyncRunnerSettings {
  pageSize: number;
  maxConsecutiveFailures: number;
  maxDeactivateRatio: number;
}

export interface SyncRunnerDeps {
  source: ProductSource;
  runs: Pick<SyncRunsRepository, 'heartbeat' | 'setPlan' | 'finish'>;
  products: Pick<ProductsRepository, 'savePage' | 'deactivateMissing'>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  logger: SyncLogger;
}

export type RunResult = (StatusDecision & { fenced: false }) | { fenced: true };

/** Ends the run with `failed` (AK-4.3). */
class FatalRunError extends Error {}

const toFailedPage = (page: number, err: ErpError): FailedPage => ({
  page,
  reason: err.reason,
  status: err.status,
  attempts: err.attempts,
  retryAfterMs: err.retryAfterMs,
  retryable: err.retryable,
  message: err.message,
});

const describe = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Runs one sync run end to end (specs/003-sync-job, "Ablauf eines Laufs").
 * The run row must already exist with status `running`.
 */
export class SyncRunner {
  constructor(
    private readonly settings: SyncRunnerSettings,
    private readonly deps: SyncRunnerDeps,
  ) {}

  async run(runId: number, signal: AbortSignal): Promise<RunResult> {
    const { runs, products, logger } = this.deps;
    const failed = new Map<number, FailedPage>();
    const outcome: RunOutcome = { missingPages: 0, totalChanged: false };

    try {
      const first = await this.fetchFirstPage(runId, signal);
      const total = first.total;
      const pagesTotal = Math.ceil(total / this.settings.pageSize);
      await runs.setPlan(runId, total, pagesTotal);
      await this.save(runId, 1, first);

      // First pass (AK-2.1, AK-5.1, AK-5.6).
      let consecutive = 0;
      for (let page = 2; page <= pagesTotal; page++) {
        const result = await this.fetchAndSave(
          runId,
          page,
          total,
          signal,
          outcome,
        );
        if (result === 'ok') {
          consecutive = 0;
          failed.delete(page);
          continue;
        }
        failed.set(page, result);
        consecutive++;
        if (consecutive >= this.settings.maxConsecutiveFailures) {
          throw new FatalRunError(
            `${consecutive} consecutive pages failed, ERP considered unavailable (last: page ${page}: ${result.message})`,
          );
        }
      }

      await this.secondPass(runId, total, failed, signal, outcome);

      outcome.missingPages = failed.size;
      for (const f of failed.values()) {
        logger.error(
          `sync run ${runId}: page ${f.page} missing (${f.reason}): ${f.message}`,
        );
      }

      let decision = decideStatus(outcome);
      if (decision.deactivate) {
        const deactivation = await products.deactivateMissing(
          runId,
          this.settings.maxDeactivateRatio,
        );
        if (deactivation.blocked) {
          logger.warn(`sync run ${runId}: ${deactivation.reason}`);
          decision = decideStatus({
            ...outcome,
            deactivationBlocked: deactivation.reason,
          });
        }
      }
      return await this.finish(runId, decision, failed);
    } catch (err) {
      if (err instanceof FencedError) {
        // Another run took over; our row is not ours to change (AK-7.5).
        logger.warn(err.message);
        return { fenced: true };
      }
      const decision = decideStatus({
        ...outcome,
        missingPages: failed.size,
        fatalError: this.fatalReason(err, signal),
      });
      logger.error(`sync run ${runId} failed: ${decision.error}`);
      return await this.finish(runId, decision, failed);
    }
  }

  /** Page 1 gets one immediate second try, else the run cannot be planned (AK-2.2). */
  private async fetchFirstPage(
    runId: number,
    signal: AbortSignal,
  ): Promise<ProductPage> {
    const { runs, source, sleep, logger } = this.deps;
    for (let attempt = 1; ; attempt++) {
      await runs.heartbeat(runId);
      try {
        return await source.fetchPage(1, this.settings.pageSize, signal);
      } catch (err) {
        if (!(err instanceof ErpError) || err.reason === 'aborted') throw err;
        if (attempt === 2 || !err.retryable || err.reason === 'rateLimited') {
          throw new FatalRunError(
            `page 1 failed, total unknown: ${err.message}`,
          );
        }
        const wait = err.retryAfterMs ?? 0;
        logger.warn(
          `sync run ${runId}: page 1 failed, retrying once in ${wait} ms: ${err.message}`,
        );
        await runs.heartbeat(runId);
        if (wait > 0) await sleep(wait, signal);
      }
    }
  }

  /** Retries retryable pages once, after the longest Retry-After (AK-5.2–5.5). */
  private async secondPass(
    runId: number,
    total: number,
    failed: Map<number, FailedPage>,
    signal: AbortSignal,
    outcome: RunOutcome,
  ): Promise<void> {
    const retry = [...failed.values()].filter(
      (f) => f.retryable && f.reason !== 'rateLimited',
    );
    if (retry.length === 0) return;

    const wait = Math.max(0, ...retry.map((f) => f.retryAfterMs ?? 0));
    this.deps.logger.warn(
      `sync run ${runId}: second pass for pages ${retry.map((f) => f.page).join(', ')} in ${wait} ms`,
    );
    await this.deps.runs.heartbeat(runId);
    if (wait > 0) await this.deps.sleep(wait, signal);

    for (const { page } of retry) {
      const result = await this.fetchAndSave(
        runId,
        page,
        total,
        signal,
        outcome,
      );
      if (result === 'ok') failed.delete(page);
      else failed.set(page, result);
    }
  }

  /** Heartbeat before every fetch, whether the last page worked or not (AK-7.3). */
  private async fetchAndSave(
    runId: number,
    page: number,
    total: number,
    signal: AbortSignal,
    outcome: RunOutcome,
  ): Promise<'ok' | FailedPage> {
    await this.deps.runs.heartbeat(runId);
    let result: ProductPage;
    try {
      result = await this.deps.source.fetchPage(
        page,
        this.settings.pageSize,
        signal,
      );
    } catch (err) {
      if (!(err instanceof ErpError) || err.reason === 'aborted') throw err;
      this.deps.logger.warn(
        `sync run ${runId}: page ${page} failed (${err.reason}): ${err.message}`,
      );
      return toFailedPage(page, err);
    }
    if (result.total !== total && !outcome.totalChanged) {
      outcome.totalChanged = true;
      this.deps.logger.warn(
        `sync run ${runId}: total changed from ${total} to ${result.total} at page ${page}; no deactivation this run`,
      );
    }
    await this.save(runId, page, result);
    return 'ok';
  }

  private async save(
    runId: number,
    page: number,
    result: ProductPage,
  ): Promise<void> {
    const diff = await this.deps.products.savePage(runId, result.items);
    if (diff.duplicateIds.length > 0) {
      this.deps.logger.warn(
        `sync run ${runId}: page ${page} contained duplicate ids ${diff.duplicateIds.join(', ')}; kept the last occurrence`,
      );
    }
  }

  private fatalReason(err: unknown, signal: AbortSignal): string {
    if (signal.aborted) return `aborted: ${describe(signal.reason)}`;
    if (err instanceof FatalRunError) return err.message;
    if (err instanceof ErpError) return `ERP error: ${err.message}`;
    return `database error: ${describe(err)}`;
  }

  private async finish(
    runId: number,
    decision: StatusDecision,
    failed: Map<number, FailedPage>,
  ): Promise<RunResult> {
    const closed = await this.deps.runs.finish(runId, {
      status: decision.status,
      error: decision.error,
      failedPages: [...failed.values()].sort((a, b) => a.page - b.page),
    });
    if (!closed) {
      this.deps.logger.warn(
        `sync run ${runId} was taken over before it could finish`,
      );
      return { fenced: true };
    }
    this.deps.logger.log(
      `sync run ${runId} ${decision.status}${decision.error ? `: ${decision.error}` : ''}`,
    );
    return { ...decision, fenced: false };
  }
}
