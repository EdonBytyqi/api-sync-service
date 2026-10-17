import type pg from 'pg';
import { isUniqueViolation, withTransaction } from '../db/transaction.js';
import type { FinalStatus, RunStatus } from './run-status.js';

export type SyncTrigger = 'schedule' | 'manual';

export interface FailedPage {
  page: number;
  reason: string;
  status?: number;
  attempts: number;
  retryAfterMs?: number;
  retryable: boolean;
  message: string;
}

export interface SyncRun {
  id: number;
  trigger: SyncTrigger;
  status: RunStatus;
  startedAt: string;
  heartbeatAt: string;
  finishedAt: string | null;
  pageSize: number;
  totalExpected: number | null;
  pagesTotal: number | null;
  pagesOk: number;
  pagesFailed: number;
  productsInserted: number;
  productsUpdated: number;
  productsUnchanged: number;
  productsReactivated: number;
  productsDeactivated: number;
  failedPages: FailedPage[];
  error: string | null;
}

export type StartResult =
  | { started: true; run: SyncRun; abandonedRunIds: number[] }
  | { started: false; runningRunId: number | null };

/** The run's row is no longer `running`: another run declared it abandoned (AK-7.5). */
export class FencedError extends Error {
  constructor(readonly runId: number) {
    super(
      `sync run ${runId} is no longer running (declared abandoned); stopping`,
    );
    this.name = 'FencedError';
  }
}

type Queryable = Pick<pg.ClientBase, 'query'>;

/**
 * Heartbeat with fencing: bumps heartbeat_at (database clock, AK-7.6) only
 * while the run is still `running`, otherwise throws FencedError.
 */
export async function touchRun(db: Queryable, runId: number): Promise<void> {
  const { rowCount } = await db.query(
    `UPDATE sync_runs SET heartbeat_at = now() WHERE id = $1 AND status = 'running'`,
    [runId],
  );
  if (rowCount !== 1) throw new FencedError(runId);
}

interface SyncRunRow {
  id: string;
  trigger: SyncTrigger;
  status: RunStatus;
  started_at: Date;
  heartbeat_at: Date;
  finished_at: Date | null;
  page_size: number;
  total_expected: number | null;
  pages_total: number | null;
  pages_ok: number;
  pages_failed: number;
  products_inserted: number;
  products_updated: number;
  products_unchanged: number;
  products_reactivated: number;
  products_deactivated: number;
  failed_pages: FailedPage[];
  error: string | null;
}

const toRun = (r: SyncRunRow): SyncRun => ({
  id: Number(r.id),
  trigger: r.trigger,
  status: r.status,
  startedAt: r.started_at.toISOString(),
  heartbeatAt: r.heartbeat_at.toISOString(),
  finishedAt: r.finished_at?.toISOString() ?? null,
  pageSize: r.page_size,
  totalExpected: r.total_expected,
  pagesTotal: r.pages_total,
  pagesOk: r.pages_ok,
  pagesFailed: r.pages_failed,
  productsInserted: r.products_inserted,
  productsUpdated: r.products_updated,
  productsUnchanged: r.products_unchanged,
  productsReactivated: r.products_reactivated,
  productsDeactivated: r.products_deactivated,
  failedPages: r.failed_pages,
  error: r.error,
});

export class SyncRunsRepository {
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Starts a run unless one is running (AK-7.1). Abandoned runs (heartbeat
   * older than staleAfterMs) are closed first, in the same transaction (AK-7.4).
   * The partial unique index decides races between instances (AK-7.2).
   */
  async start(
    trigger: SyncTrigger,
    pageSize: number,
    staleAfterMs: number,
  ): Promise<StartResult> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const abandoned = await client.query<{ id: string }>(
          `UPDATE sync_runs
              SET status = 'failed', finished_at = now(),
                  error = 'abandoned: no heartbeat since '
                          || to_char(heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            WHERE status = 'running' AND heartbeat_at < now() - $1 * interval '1 millisecond'
        RETURNING id`,
          [staleAfterMs],
        );
        const { rows } = await client.query<SyncRunRow>(
          `INSERT INTO sync_runs (trigger, status, page_size) VALUES ($1, 'running', $2) RETURNING *`,
          [trigger, pageSize],
        );
        return {
          started: true as const,
          run: toRun(rows[0]),
          abandonedRunIds: abandoned.rows.map((r) => Number(r.id)),
        };
      });
    } catch (err) {
      if (!isUniqueViolation(err, 'sync_runs_one_running')) throw err;
      const running = await this.findRunning();
      return { started: false, runningRunId: running?.id ?? null };
    }
  }

  heartbeat(runId: number): Promise<void> {
    return touchRun(this.pool, runId);
  }

  async setPlan(
    runId: number,
    totalExpected: number,
    pagesTotal: number,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE sync_runs SET total_expected = $2, pages_total = $3 WHERE id = $1 AND status = 'running'`,
      [runId, totalExpected, pagesTotal],
    );
  }

  /** Closes the run. Returns false if it was no longer running (fenced). */
  async finish(
    runId: number,
    result: { status: FinalStatus; error?: string; failedPages: FailedPage[] },
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE sync_runs
          SET status = $2, finished_at = now(), error = $3,
              failed_pages = $4::jsonb, pages_failed = $5
        WHERE id = $1 AND status = 'running'`,
      [
        runId,
        result.status,
        result.error ?? null,
        JSON.stringify(result.failedPages),
        result.failedPages.length,
      ],
    );
    return rowCount === 1;
  }

  async findById(id: number): Promise<SyncRun | null> {
    const { rows } = await this.pool.query<SyncRunRow>(
      'SELECT * FROM sync_runs WHERE id = $1',
      [id],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async findRunning(): Promise<SyncRun | null> {
    const { rows } = await this.pool.query<SyncRunRow>(
      `SELECT * FROM sync_runs WHERE status = 'running'`,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async list(limit: number): Promise<SyncRun[]> {
    const { rows } = await this.pool.query<SyncRunRow>(
      'SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT $1',
      [limit],
    );
    return rows.map(toRun);
  }
}
