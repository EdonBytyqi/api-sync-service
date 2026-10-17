const DEFAULTS = {
  FAILURE_RATE: 0.2,
  SLOW_RATE: 0.1,
  RATE_LIMIT_RATE: 0.05,
  SLOW_MS: 5000,
  PORT: 4000,
};

const isRate = (v) => v >= 0 && v <= 1; // false for NaN
const isNonNegativeInt = (v, raw) => /^\d+$/.test(raw) && Number.isSafeInteger(v);
const isPort = (v, raw) => isNonNegativeInt(v, raw) && v >= 1 && v <= 65535;

// Fails loudly on bad input: Math.random() < NaN is always false, so a typo
// like FAILURE_RATE=abc would otherwise silently switch failures off.
export function loadConfig(env = {}) {
  const errors = [];
  const read = (name, isValid, rule) => {
    const raw = env[name];
    if (raw === undefined) return DEFAULTS[name];
    const value = raw.trim() === '' ? NaN : Number(raw);
    if (!isValid(value, raw)) errors.push(`${name}=${JSON.stringify(raw)} must be ${rule}`);
    return value;
  };

  const config = {
    failureRate: read('FAILURE_RATE', isRate, 'a number between 0 and 1'),
    slowRate: read('SLOW_RATE', isRate, 'a number between 0 and 1'),
    rateLimitRate: read('RATE_LIMIT_RATE', isRate, 'a number between 0 and 1'),
    slowMs: read('SLOW_MS', isNonNegativeInt, 'a non-negative integer'),
    port: read('PORT', isPort, 'an integer between 1 and 65535'),
  };

  // 500 and 429 share one roll, so their ranges must fit into [0, 1).
  if (errors.length === 0 && config.failureRate + config.rateLimitRate > 1) {
    errors.push(
      `FAILURE_RATE + RATE_LIMIT_RATE must not exceed 1 (got ${config.failureRate} + ${config.rateLimitRate})`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Invalid mock-erp configuration:\n  ${errors.join('\n  ')}`);
  }
  return config;
}
