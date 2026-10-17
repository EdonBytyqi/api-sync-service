/** Shapes of the sync API (spec 003, GET /sync/runs). */
export type RunStatus = 'running' | 'completed' | 'partial' | 'failed';
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

export type StartOutcome =
  | { kind: 'started'; id: number }
  | { kind: 'running'; id: number | null }
  | { kind: 'error'; message: string };
