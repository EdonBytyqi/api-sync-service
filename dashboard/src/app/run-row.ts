import { Component, computed, input, signal } from '@angular/core';
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  runDurationMs,
  TRIGGER_TEXT,
} from './format';
import type { SyncRun } from './models';
import { StatusBadge } from './status-badge';

export const COLUMN_COUNT = 11;

/**
 * One run as its own <tbody>: the summary row plus a details row. A table may
 * have several <tbody>, so the host element keeps table semantics intact.
 * Expanding is a real <button> with aria-expanded/aria-controls (AK-5.2).
 */
@Component({
  selector: 'tbody[app-run-row]',
  imports: [StatusBadge],
  host: { '[class.highlight]': 'highlighted()' },
  template: `
    <tr>
      <th scope="row">
        <button
          type="button"
          class="expander"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="detailsId()"
          (click)="expanded.set(!expanded())"
        >
          <span aria-hidden="true">{{ expanded() ? '▾' : '▸' }}</span>
          <span class="visually-hidden">Details zu Lauf </span>#{{ run().id }}
        </button>
      </th>
      <td>{{ trigger() }}</td>
      <td class="status-cell">
        <app-status-badge [status]="run().status" />
        @if (run().error; as error) {
          <span class="error-line">{{ error }}</span>
        }
      </td>
      <td><time [attr.datetime]="run().startedAt">{{ started() }}</time></td>
      <td>
        @if (run().status === 'running') {
          läuft seit {{ duration() }}
        } @else {
          {{ duration() }}
        }
      </td>
      <td class="pages">
        @if (run().status === 'running') {
          @if (run().pagesTotal; as total) {
            <progress
              [value]="run().pagesOk"
              [max]="total"
              [attr.aria-label]="'Seite ' + run().pagesOk + ' von ' + total"
            ></progress>
            <span aria-hidden="true">{{ pages() }}</span>
          } @else {
            wird vorbereitet
          }
        } @else {
          {{ pages() }}
        }
      </td>
      <td class="num">{{ n(run().productsInserted) }}</td>
      <td class="num">{{ n(run().productsUpdated) }}</td>
      <td class="num">{{ n(run().productsUnchanged) }}</td>
      <td class="num">{{ n(run().productsReactivated) }}</td>
      <td class="num">{{ n(run().productsDeactivated) }}</td>
    </tr>
    <tr class="details" [id]="detailsId()" [hidden]="!expanded()">
      <td [attr.colspan]="columns">
        @if (run().error; as error) {
          <p class="error-full"><strong>Grund:</strong> {{ error }}</p>
        }
        @if (run().failedPages.length === 0) {
          <p>Keine gescheiterten Seiten</p>
        } @else {
          <table class="failed-pages">
            <caption>
              Gescheiterte Seiten von Lauf #{{ run().id }}
            </caption>
            <thead>
              <tr>
                <th scope="col">Seite</th>
                <th scope="col">Grund</th>
                <th scope="col">HTTP-Status</th>
                <th scope="col">Versuche</th>
                <th scope="col">Retry-After</th>
                <th scope="col">Meldung</th>
              </tr>
            </thead>
            <tbody>
              @for (page of run().failedPages; track page.page) {
                <tr>
                  <td class="num">{{ page.page }}</td>
                  <td>{{ page.reason }}</td>
                  <td class="num">{{ page.status ?? '–' }}</td>
                  <td class="num">{{ page.attempts }}</td>
                  <td class="num">{{ page.retryAfterMs != null ? n(page.retryAfterMs / 1000) + ' s' : '–' }}</td>
                  <td>{{ page.message }}</td>
                </tr>
              }
            </tbody>
          </table>
        }
      </td>
    </tr>
  `,
})
export class RunRow {
  readonly run = input.required<SyncRun>();
  readonly now = input.required<Date>();
  readonly highlighted = input(false);
  readonly expanded = signal(false);

  protected readonly columns = COLUMN_COUNT;
  protected readonly n = formatNumber;
  protected readonly detailsId = computed(() => `run-${this.run().id}-details`);
  protected readonly trigger = computed(() => TRIGGER_TEXT[this.run().trigger]);
  protected readonly started = computed(() => formatDateTime(this.run().startedAt));
  protected readonly duration = computed(() => formatDuration(runDurationMs(this.run(), this.now())));
  protected readonly pages = computed(() => {
    const { pagesOk, pagesTotal } = this.run();
    return `${formatNumber(pagesOk)} / ${pagesTotal === null ? '–' : formatNumber(pagesTotal)}`;
  });
}
