import axe from 'axe-core';
import { expect } from 'vitest';
import type { SyncRun } from './models';

export const run = (overrides: Partial<SyncRun> = {}): SyncRun => ({
  id: 1,
  trigger: 'manual',
  status: 'completed',
  startedAt: '2026-10-17T13:05:58.000Z',
  heartbeatAt: '2026-10-17T13:06:47.000Z',
  finishedAt: '2026-10-17T13:06:47.000Z',
  pageSize: 100,
  totalExpected: 10_000,
  pagesTotal: 100,
  pagesOk: 100,
  pagesFailed: 0,
  productsInserted: 10_000,
  productsUpdated: 0,
  productsUnchanged: 0,
  productsReactivated: 0,
  productsDeactivated: 0,
  failedPages: [],
  error: null,
  ...overrides,
});

export const running = (overrides: Partial<SyncRun> = {}): SyncRun =>
  run({ status: 'running', finishedAt: null, pagesOk: 37, ...overrides });

/**
 * axe-core over the rendered DOM (AK-5.9). Colour contrast is off: jsdom
 * does not compute styles, so contrast is checked by scripts/contrast.mjs.
 */
export async function expectNoA11yViolations(el: Element): Promise<void> {
  const results = await axe.run(el, { rules: { 'color-contrast': { enabled: false } } });
  const violations = results.violations.map(
    (v) => `${v.id}: ${v.help} → ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
  );
  expect(violations).toEqual([]);
}
