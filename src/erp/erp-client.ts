import type { ErpConfig } from './erp-config.js';
import { ErpError, type ErpErrorReason } from './erp-error.js';
import {
  type AttemptOutcome,
  classify,
  retryAfterOf,
  retryDelay,
} from './retry-policy.js';

export interface Product {
  id: number;
  sku: string;
  name: string;
  priceCents: number;
  updatedAt: string;
}

export interface ProductPage {
  items: Product[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ErpLogger {
  warn(message: string, context: Record<string, unknown>): void;
}

export interface ErpClientDeps {
  fetch: typeof globalThis.fetch;
  /** Resolves after `ms`; rejects as soon as `signal` aborts. */
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Returns a number in [0, 1). */
  random: () => number;
  /** Milliseconds since the epoch. */
  now: () => number;
  logger: ErpLogger;
}

export const MAX_PAGE_SIZE = 1000;

export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

const consoleLogger: ErpLogger = {
  warn: (message, context) => console.warn(message, context),
};

type FailedAttempt = {
  ok: false;
  outcome: Exclude<AttemptOutcome, { kind: 'success' }>;
  message: string;
  cause?: unknown;
};
type AttemptResult = { ok: true; page: ProductPage } | FailedAttempt;

const isPositiveInt = (n: unknown): n is number =>
  Number.isInteger(n) && (n as number) > 0;

/**
 * Fetches one page of products from the ERP, with a timeout per attempt and
 * retries for transient failures. See specs/002-erp-client.
 */
export class ErpClient {
  private readonly deps: ErpClientDeps;

  constructor(
    private readonly config: ErpConfig,
    deps: Partial<ErpClientDeps> = {},
  ) {
    this.deps = {
      fetch: (input, init) => globalThis.fetch(input, init),
      sleep: abortableSleep,
      random: Math.random,
      now: Date.now,
      logger: consoleLogger,
      ...deps,
    };
  }

  /** Upper bound for one fetchPage call (AK-10.1). */
  static maxDurationMs(config: ErpConfig): number {
    const longestPause = Math.max(config.maxDelayMs, config.maxRetryAfterMs);
    return (
      config.maxAttempts * config.timeoutMs +
      (config.maxAttempts - 1) * longestPause
    );
  }

  async fetchPage(
    page: number,
    pageSize: number,
    signal?: AbortSignal,
  ): Promise<ProductPage> {
    if (
      !isPositiveInt(page) ||
      !isPositiveInt(pageSize) ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new ErpError(
        `Invalid arguments page=${page}, pageSize=${pageSize}: positive integers, pageSize <= ${MAX_PAGE_SIZE}`,
        { reason: 'invalidArgument', retryable: false, attempts: 0 },
      );
    }

    const path = `/products?page=${page}&pageSize=${pageSize}`;
    const { maxAttempts, maxRetryAfterMs } = this.config;

    for (let attempt = 1; ; attempt++) {
      if (signal?.aborted) throw this.aborted(path, attempt - 1, signal.reason);

      const result = await this.attempt(path, page, pageSize, attempt, signal);
      if (result.ok) return result.page;

      const verdict = classify(result.outcome);
      if (verdict === 'fail' || attempt >= maxAttempts) {
        throw this.failure(path, result, attempt, verdict === 'retry');
      }

      const { delayMs, source } = retryDelay(
        result.outcome,
        attempt,
        this.config,
        this.deps.random,
        this.deps.now(),
      );
      if (source === 'retryAfter' && delayMs > maxRetryAfterMs) {
        throw new ErpError(
          `ERP GET ${path}: asked to retry after ${delayMs} ms, more than ${maxRetryAfterMs} ms`,
          {
            reason: 'rateLimited',
            retryable: true,
            attempts: attempt,
            status: this.statusOf(result.outcome),
            retryAfterMs: delayMs,
          },
        );
      }

      this.deps.logger.warn('Retrying ERP request', {
        page,
        attempt,
        reason: result.message,
        delayMs,
        delaySource: source,
      });
      try {
        await this.deps.sleep(delayMs, signal);
      } catch (cause) {
        if (signal?.aborted) throw this.aborted(path, attempt, cause);
        throw cause;
      }
    }
  }

  private async attempt(
    path: string,
    page: number,
    pageSize: number,
    attempt: number,
    signal: AbortSignal | undefined,
  ): Promise<AttemptResult> {
    const timeout = AbortSignal.timeout(this.config.timeoutMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    // Two steps on purpose: a failure while reading the body is a network
    // problem (retry); a complete body that doesn't parse is a contract
    // violation (no retry). response.json() would mix the two.
    let response: Response;
    let text: string;
    try {
      response = await this.deps.fetch(this.config.baseUrl + path, {
        headers: { Accept: 'application/json' },
        signal: attemptSignal,
      });
      text = await response.text();
    } catch (cause) {
      if (signal?.aborted) throw this.aborted(path, attempt, cause);
      if (timeout.aborted) {
        return {
          ok: false,
          outcome: { kind: 'timeout' },
          message: `timed out after ${this.config.timeoutMs} ms`,
          cause,
        };
      }
      return {
        ok: false,
        outcome: { kind: 'network' },
        message: `network error: ${describe(cause)}`,
        cause,
      };
    }

    if (!response.ok) {
      const detail = errorField(text);
      return {
        ok: false,
        outcome: {
          kind: 'http',
          status: response.status,
          retryAfter: response.headers.get('retry-after'),
        },
        message: `HTTP ${response.status}${detail ? ` (${detail})` : ''}`,
      };
    }

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (cause) {
      return {
        ok: false,
        outcome: { kind: 'invalidResponse' },
        message: 'body is not valid JSON',
        cause,
      };
    }

    const problem = validatePage(body, page, pageSize);
    if (typeof problem === 'string') {
      return {
        ok: false,
        outcome: { kind: 'invalidResponse' },
        message: problem,
      };
    }
    return { ok: true, page: problem };
  }

  private failure(
    path: string,
    result: FailedAttempt,
    attempts: number,
    retryable: boolean,
  ): ErpError {
    const reason: ErpErrorReason = result.outcome.kind;
    const tries = attempts === 1 ? '1 attempt' : `${attempts} attempts`;
    return new ErpError(
      `ERP GET ${path} failed after ${tries}: ${result.message}`,
      {
        reason,
        retryable,
        attempts,
        status: this.statusOf(result.outcome),
        // The caller needs "when may I ask again" most after the last attempt (AK-4.7).
        retryAfterMs: retryable
          ? retryAfterOf(result.outcome, this.deps.now())
          : undefined,
        cause: result.cause,
      },
    );
  }

  private aborted(path: string, attempts: number, cause: unknown): ErpError {
    return new ErpError(`ERP GET ${path} aborted by caller`, {
      reason: 'aborted',
      retryable: false,
      attempts,
      cause,
    });
  }

  private statusOf(outcome: AttemptOutcome): number | undefined {
    return outcome.kind === 'http' ? outcome.status : undefined;
  }
}

function describe(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const code = (err.cause as { code?: string } | undefined)?.code;
  return code ? `${err.message} (${code})` : err.message;
}

function errorField(text: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (
      parsed &&
      typeof parsed === 'object' &&
      'error' in parsed &&
      typeof parsed.error === 'string'
    ) {
      return parsed.error;
    }
  } catch {
    // not JSON; the status alone has to do
  }
  return undefined;
}

const ISO_UTC =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** Returns the page with only known fields, or a description of the first problem. */
function validatePage(
  body: unknown,
  page: number,
  pageSize: number,
): ProductPage | string {
  if (!isRecord(body)) return 'body is not a JSON object';
  if (body.page !== page)
    return `response page ${String(body.page)} does not match requested page ${page}`;
  if (body.pageSize !== pageSize) {
    return `response pageSize ${String(body.pageSize)} does not match requested pageSize ${pageSize}`;
  }
  if (!Number.isInteger(body.total) || (body.total as number) < 0)
    return 'total must be a non-negative integer';
  if (!Array.isArray(body.items)) return 'items must be an array';
  if (body.items.length > pageSize)
    return `items has ${body.items.length} entries, more than pageSize ${pageSize}`;

  const items: Product[] = [];
  for (const [i, item] of (body.items as unknown[]).entries()) {
    if (!isRecord(item)) return `items[${i}] is not an object`;
    if (!isPositiveInt(item.id))
      return `items[${i}].id must be a positive integer`;
    if (typeof item.sku !== 'string') return `items[${i}].sku must be a string`;
    if (typeof item.name !== 'string')
      return `items[${i}].name must be a string`;
    if (!Number.isInteger(item.priceCents) || (item.priceCents as number) < 0) {
      return `items[${i}].priceCents must be a non-negative integer`;
    }
    if (
      typeof item.updatedAt !== 'string' ||
      !ISO_UTC.test(item.updatedAt) ||
      Number.isNaN(Date.parse(item.updatedAt))
    ) {
      return `items[${i}].updatedAt must be an ISO-8601 timestamp`;
    }
    items.push({
      id: item.id,
      sku: item.sku,
      name: item.name,
      priceCents: item.priceCents as number,
      updatedAt: item.updatedAt,
    });
  }
  return { items, page, pageSize, total: body.total as number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
