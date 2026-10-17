import type { RunResult, SyncLogger, SyncRunner } from './sync-runner.js';
import type {
  StartResult,
  SyncRunsRepository,
  SyncTrigger,
} from './sync-runs.repository.js';

export interface SyncServiceSettings {
  pageSize: number;
  /** ErpClient.maxDurationMs + SYNC_STALE_MARGIN_MS (AK-7.4). */
  staleAfterMs: number;
}

interface ActiveRun {
  controller: AbortController;
  done: Promise<RunResult | undefined>;
}

/**
 * Starts runs in the background and owns their AbortControllers, so a
 * shutdown can stop them within seconds (AK-8.4).
 */
export class SyncService {
  private readonly active = new Map<number, ActiveRun>();

  constructor(
    private readonly settings: SyncServiceSettings,
    private readonly runs: Pick<SyncRunsRepository, 'start'>,
    private readonly runner: Pick<SyncRunner, 'run'>,
    private readonly logger: SyncLogger,
  ) {}

  /** Returns immediately; the run continues in the background (AK-8.2). */
  async start(trigger: SyncTrigger): Promise<StartResult> {
    const result = await this.runs.start(
      trigger,
      this.settings.pageSize,
      this.settings.staleAfterMs,
    );
    if (!result.started) return result;

    for (const id of result.abandonedRunIds) {
      this.logger.warn(
        `sync run ${id} marked failed: abandoned (no heartbeat)`,
      );
    }
    const runId = result.run.id;
    const controller = new AbortController();
    const done = this.runner
      .run(runId, controller.signal)
      .catch((err: unknown) => {
        // The runner records failures itself; this is the last safety net.
        this.logger.error(
          `sync run ${runId} crashed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return undefined;
      })
      .finally(() => this.active.delete(runId));
    this.active.set(runId, { controller, done });
    this.logger.log(`sync run ${runId} started (${trigger})`);
    return result;
  }

  /** Aborts all runs of this instance and waits until they recorded their end. */
  async stopAll(reason = 'shutdown'): Promise<void> {
    const runs = [...this.active.values()];
    for (const { controller } of runs) controller.abort(new Error(reason));
    await Promise.allSettled(runs.map((r) => r.done));
  }

  /** Resolves when no run of this instance is active. For tests and shutdown. */
  async whenIdle(): Promise<void> {
    await Promise.allSettled([...this.active.values()].map((r) => r.done));
  }
}
