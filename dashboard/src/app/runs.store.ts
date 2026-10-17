import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { STATUS_TEXT } from './format';
import type { RunStatus, SyncRun } from './models';
import { describeHttpError, SyncApi } from './sync-api.service';

export const RUN_LIMIT = 20;
export const POLL_RUNNING_MS = 3_000;
export const POLL_IDLE_MS = 30_000;

/**
 * State of the run list plus polling (spec 004, requirement 4).
 * One timer, re-armed after the newest request settles, so polling never
 * overlaps itself; responses older than the last applied one are dropped.
 */
@Injectable({ providedIn: 'root' })
export class RunsStore {
  private readonly api = inject(SyncApi);
  private readonly doc = inject(DOCUMENT);

  readonly runs = signal<SyncRun[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastUpdated = signal<Date | null>(null);
  /** Text for the polite live region (AK-5.3). */
  readonly announcement = signal('');
  readonly runningRun = computed(() => this.runs().find((r) => r.status === 'running') ?? null);

  private seq = 0;
  private applied = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly subs = new Set<Subscription>();
  private previous: Map<number, RunStatus> | null = null;
  private readonly onVisibility = () => {
    if (this.doc.visibilityState === 'hidden') this.clearTimer();
    else this.refresh();
  };

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  start(): void {
    this.doc.addEventListener('visibilitychange', this.onVisibility);
    this.refresh();
  }

  stop(): void {
    this.doc.removeEventListener('visibilitychange', this.onVisibility);
    this.clearTimer();
    for (const s of this.subs) s.unsubscribe();
    this.subs.clear();
  }

  announce(text: string): void {
    this.announcement.set(text);
  }

  refresh(): void {
    this.clearTimer();
    const id = ++this.seq;
    const sub = this.api.listRuns(RUN_LIMIT).subscribe({
      next: (runs) => {
        if (id < this.applied) return; // a newer response already won (AK-4.3)
        this.applied = id;
        this.announceTransitions(runs);
        this.runs.set(runs);
        this.loaded.set(true);
        this.error.set(null);
        this.lastUpdated.set(new Date());
      },
      error: (err: unknown) => {
        if (id < this.applied) return;
        this.applied = id;
        this.loaded.set(true);
        this.error.set(describeHttpError(err));
      },
    });
    this.subs.add(sub);
    sub.add(() => {
      this.subs.delete(sub);
      if (id === this.seq) this.schedule();
    });
  }

  private schedule(): void {
    this.clearTimer();
    if (this.doc.visibilityState === 'hidden') return; // resumes on visibilitychange (AK-4.2)
    const delay = this.runningRun() ? POLL_RUNNING_MS : POLL_IDLE_MS;
    this.timer = setTimeout(() => this.refresh(), delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Only running → final is worth interrupting a screen reader for (AK-4.4). */
  private announceTransitions(runs: SyncRun[]): void {
    const before = this.previous;
    this.previous = new Map(runs.map((r) => [r.id, r.status]));
    if (!before) return; // first load: nothing changed from the user's point of view
    for (const run of runs) {
      if (before.get(run.id) === 'running' && run.status !== 'running') {
        this.announce(`Lauf #${run.id} ${STATUS_TEXT[run.status]}`);
      }
    }
  }
}
