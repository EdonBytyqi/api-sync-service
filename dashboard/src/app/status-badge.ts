import { Component, computed, input } from '@angular/core';
import { STATUS_ICON, STATUS_TEXT } from './format';
import type { RunStatus } from './models';

/** Status as icon + text, never colour alone (AK-2.1). The icon is decorative. */
@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [class]="'badge status-' + status()"
    ><span class="icon" aria-hidden="true">{{ icon() }}</span> {{ text() }}</span
  >`,
})
export class StatusBadge {
  readonly status = input.required<RunStatus>();
  protected readonly icon = computed(() => STATUS_ICON[this.status()]);
  protected readonly text = computed(() => STATUS_TEXT[this.status()]);
}
