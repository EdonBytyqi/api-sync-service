import type { ErpConfig } from './erp-config.js';

/** What a single attempt ended with, before deciding whether to retry. */
export type AttemptOutcome =
  | { kind: 'success' }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'invalidResponse' }
  | { kind: 'http'; status: number; retryAfter?: string | null };

export type Verdict = 'success' | 'retry' | 'fail';

// 408 and 429 describe a state, not a wrong request. Other 5xx (501, 505)
// mean "this will never work" and are final.
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const RETRY_AFTER_STATUS = new Set([429, 503]);

export function classify(outcome: AttemptOutcome): Verdict {
  switch (outcome.kind) {
    case 'success':
      return 'success';
    case 'timeout':
    case 'network':
      return 'retry';
    case 'invalidResponse':
      return 'fail';
    case 'http':
      return RETRYABLE_STATUS.has(outcome.status) ? 'retry' : 'fail';
  }
}

/** Full jitter: random() × min(maxDelayMs, baseDelayMs × 2^(attempt−1)). */
export function backoffDelay(
  attempt: number,
  config: Pick<ErpConfig, 'baseDelayMs' | 'maxDelayMs'>,
  random: () => number,
): number {
  const cap = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** (attempt - 1),
  );
  return random() * cap;
}

const DELTA_SECONDS = /^\d+$/;
// IMF-fixdate, e.g. "Wed, 21 Oct 2026 07:28:00 GMT". Date.parse alone is not
// enough: in V8, Date.parse('-1') and Date.parse('5') return valid dates.
const IMF_FIXDATE =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** Returns the wait in ms, or undefined if the header is missing or invalid. */
export function parseRetryAfter(
  header: string | null | undefined,
  now: number,
): number | undefined {
  if (header == null) return undefined;
  const value = header.trim();
  if (DELTA_SECONDS.test(value)) return Number(value) * 1000;
  if (IMF_FIXDATE.test(value)) {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) return Math.max(0, at - now);
  }
  return undefined;
}

export interface RetryDelay {
  delayMs: number;
  source: 'retryAfter' | 'backoff';
}

/** The server-requested wait for 429/503 with a valid Retry-After, else undefined. */
export function retryAfterOf(
  outcome: AttemptOutcome,
  now: number,
): number | undefined {
  if (outcome.kind !== 'http' || !RETRY_AFTER_STATUS.has(outcome.status)) {
    return undefined;
  }
  return parseRetryAfter(outcome.retryAfter, now);
}

/** How long to wait after `attempt` failed with a retryable `outcome`. */
export function retryDelay(
  outcome: AttemptOutcome,
  attempt: number,
  config: Pick<ErpConfig, 'baseDelayMs' | 'maxDelayMs'>,
  random: () => number,
  now: number,
): RetryDelay {
  const delayMs = retryAfterOf(outcome, now);
  if (delayMs !== undefined) return { delayMs, source: 'retryAfter' };
  return { delayMs: backoffDelay(attempt, config, random), source: 'backoff' };
}
