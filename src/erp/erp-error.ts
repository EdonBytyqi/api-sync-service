export type ErpErrorReason =
  | 'timeout'
  | 'network'
  | 'http'
  | 'rateLimited'
  | 'invalidResponse'
  | 'invalidArgument'
  | 'aborted';

export interface ErpErrorDetails {
  reason: ErpErrorReason;
  /** True if the same request might succeed later, e.g. on the next sync run. */
  retryable: boolean;
  /** Number of HTTP requests sent; 0 if none was sent. */
  attempts: number;
  status?: number;
  /** Set when the ERP asked to wait longer than maxRetryAfterMs. */
  retryAfterMs?: number;
  cause?: unknown;
}

export class ErpError extends Error {
  readonly reason: ErpErrorReason;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(message: string, details: ErpErrorDetails) {
    super(message, { cause: details.cause });
    this.name = 'ErpError';
    this.reason = details.reason;
    this.retryable = details.retryable;
    this.attempts = details.attempts;
    this.status = details.status;
    this.retryAfterMs = details.retryAfterMs;
  }
}
