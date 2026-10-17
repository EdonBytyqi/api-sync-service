import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, type Observable, of } from 'rxjs';
import type { StartOutcome, SyncRun } from './models';

/** Relative path: same origin, no CORS; proxied to the service (AK-6.1). */
export const API = '/api';

export function describeHttpError(err: unknown): string {
  if (!(err instanceof HttpErrorResponse)) return String(err);
  if (err.status === 0) return 'Server nicht erreichbar';
  const body = err.error as { message?: unknown; error?: unknown } | null;
  const detail = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
  return detail ? `HTTP ${err.status}: ${detail}` : `HTTP ${err.status}`;
}

@Injectable({ providedIn: 'root' })
export class SyncApi {
  private readonly http = inject(HttpClient);

  listRuns(limit: number): Observable<SyncRun[]> {
    return this.http.get<SyncRun[]>(`${API}/sync/runs`, { params: { limit } });
  }

  /** 202 → started, 409 → already running (information, not an error), else error. */
  startSync(): Observable<StartOutcome> {
    return this.http.post<{ id: number }>(`${API}/sync`, null).pipe(
      map((body): StartOutcome => ({ kind: 'started', id: body.id })),
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 409) {
          const body = err.error as { runningRunId?: number | null } | null;
          return of<StartOutcome>({ kind: 'running', id: body?.runningRunId ?? null });
        }
        return of<StartOutcome>({ kind: 'error', message: describeHttpError(err) });
      }),
    );
  }
}
