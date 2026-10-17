import { Component, computed, inject, type OnInit, signal } from '@angular/core';
import { formatTime } from './format';
import { RunRow } from './run-row';
import { RUN_LIMIT, RunsStore } from './runs.store';
import { SyncApi } from './sync-api.service';

@Component({
  selector: 'app-root',
  imports: [RunRow],
  templateUrl: './app.html',
})
export class App implements OnInit {
  protected readonly store = inject(RunsStore);
  private readonly api = inject(SyncApi);

  protected readonly limit = RUN_LIMIT;
  protected readonly starting = signal(false);
  protected readonly startError = signal<string | null>(null);
  protected readonly highlightId = signal<number | null>(null);

  /** Locked via aria-disabled, never `disabled`, so focus stays on the button (AK-3.6). */
  protected readonly blocked = computed(() => this.starting() || this.store.runningRun() !== null);
  protected readonly blockedReason = computed(() => {
    const running = this.store.runningRun();
    return !this.starting() && running ? `Lauf #${running.id} läuft` : null;
  });
  protected readonly now = computed(() => this.store.lastUpdated() ?? new Date());
  protected readonly lastUpdatedText = computed(() => {
    const at = this.store.lastUpdated();
    return at ? formatTime(at) : null;
  });

  ngOnInit(): void {
    this.store.start();
  }

  protected startSync(): void {
    if (this.blocked()) return; // click guard: aria-disabled alone does not stop clicks
    this.starting.set(true);
    this.startError.set(null);
    this.api.startSync().subscribe((outcome) => {
      this.starting.set(false);
      switch (outcome.kind) {
        case 'started':
          this.highlightId.set(outcome.id);
          this.store.announce(`Lauf #${outcome.id} gestartet`);
          this.store.refresh();
          break;
        case 'running':
          // 409 is a normal state, not an error (AK-3.3).
          this.highlightId.set(outcome.id);
          this.store.announce(
            outcome.id === null ? 'Ein Lauf läuft bereits' : `Lauf #${outcome.id} läuft bereits`,
          );
          this.store.refresh();
          break;
        case 'error':
          this.startError.set(`Lauf konnte nicht gestartet werden: ${outcome.message}`);
          break;
      }
    });
  }

  protected retry(): void {
    this.store.refresh();
  }
}
