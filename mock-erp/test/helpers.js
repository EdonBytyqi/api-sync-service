import { vi } from 'vitest';
import { loadConfig } from '../config.js';

// Default rates, so tests exercise the real 5% / 20% / 10% ranges.
export const defaultConfig = (overrides = {}) => ({ ...loadConfig({}), ...overrides });

export const stableConfig = (overrides = {}) =>
  defaultConfig({ failureRate: 0, slowRate: 0, rateLimitRate: 0, ...overrides });

// Returns the given values in order and fails the test if more are drawn.
export function sequence(...values) {
  let i = 0;
  return vi.fn(() => {
    if (i >= values.length) throw new Error(`random() called more than ${values.length} times`);
    return values[i++];
  });
}

export const noSleep = () => vi.fn(async () => {});

// rollChaos draws [delay, status]. These values hit each range of the default config.
export const NOT_SLOW = 0.99;
export const SLOW = 0.01;
export const OK = 0.99;
export const RATE_LIMITED = 0.01; // < 0.05
export const ERROR = 0.1; // in [0.05, 0.25)
