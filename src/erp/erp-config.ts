export interface ErpConfig {
  baseUrl: string;
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetryAfterMs: number;
}

export const ERP_CONFIG_DEFAULTS: ErpConfig = {
  baseUrl: 'http://localhost:4000',
  timeoutMs: 2000,
  maxAttempts: 5,
  baseDelayMs: 200,
  maxDelayMs: 5000,
  maxRetryAfterMs: 30_000,
};

// Digits only: Number() alone would accept '1e3', '0x10' and ' 5'.
const POSITIVE_INT = /^[1-9]\d*$/;

/**
 * Reads and validates the ERP client settings. Reports every invalid
 * variable at once so a misconfigured deploy fails with one clear message.
 */
export function loadErpConfig(
  env: Record<string, string | undefined> = {},
): ErpConfig {
  const errors: string[] = [];

  const readInt = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!POSITIVE_INT.test(raw) || !Number.isSafeInteger(value)) {
      errors.push(`${name}=${JSON.stringify(raw)} must be a positive integer`);
    }
    return value;
  };

  const readUrl = (name: string, fallback: string): string => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    try {
      const url = new URL(raw);
      if (url.protocol === 'http:' || url.protocol === 'https:')
        return raw.replace(/\/+$/, '');
    } catch {
      // reported below
    }
    errors.push(`${name}=${JSON.stringify(raw)} must be an http(s) URL`);
    return raw;
  };

  const config: ErpConfig = {
    baseUrl: readUrl('ERP_BASE_URL', ERP_CONFIG_DEFAULTS.baseUrl),
    timeoutMs: readInt('ERP_TIMEOUT_MS', ERP_CONFIG_DEFAULTS.timeoutMs),
    maxAttempts: readInt('ERP_MAX_ATTEMPTS', ERP_CONFIG_DEFAULTS.maxAttempts),
    baseDelayMs: readInt('ERP_BASE_DELAY_MS', ERP_CONFIG_DEFAULTS.baseDelayMs),
    maxDelayMs: readInt('ERP_MAX_DELAY_MS', ERP_CONFIG_DEFAULTS.maxDelayMs),
    maxRetryAfterMs: readInt(
      'ERP_MAX_RETRY_AFTER_MS',
      ERP_CONFIG_DEFAULTS.maxRetryAfterMs,
    ),
  };

  if (errors.length === 0 && config.maxDelayMs < config.baseDelayMs) {
    errors.push(
      `ERP_MAX_DELAY_MS (${config.maxDelayMs}) must be >= ERP_BASE_DELAY_MS (${config.baseDelayMs})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid ERP client configuration:\n  ${errors.join('\n  ')}`,
    );
  }
  return config;
}
