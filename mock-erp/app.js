import express from 'express';

export const TOTAL = 10_000;
export const MAX_PAGE_SIZE = 1000;
const BASE_TIME = Date.UTC(2026, 0, 1);

// Deterministic catalogue: same ids, order and values on every start.
// Prices are integer cents to avoid floating-point rounding errors with money.
export function generateProducts() {
  return Array.from({ length: TOTAL }, (_, i) => {
    const n = i + 1;
    return {
      id: n,
      sku: `SKU-${String(n).padStart(5, '0')}`,
      name: `Product ${n}`,
      priceCents: 100 + ((n * 7919) % 99_900),
      updatedAt: new Date(BASE_TIME + n * 60_000).toISOString(),
    };
  });
}

// Pure decision for one request. Draws exactly two values from `random`:
// the first decides the delay, the second the status.
// One roll for both errors so the rates don't overlap: 5% -> 429, next 20% -> 500.
export function rollChaos(config, random) {
  const slow = random() < config.slowRate;
  const roll = random();
  let outcome = 'ok';
  if (roll < config.rateLimitRate) outcome = 'rateLimited';
  else if (roll < config.rateLimitRate + config.failureRate) outcome = 'error';
  return { slow, outcome };
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Digits only: Number() alone would accept '1e2', '0x10', ' 5' and '+5'.
const POSITIVE_INT = /^[1-9]\d*$/;
const parsePositiveInt = (value, fallback) => {
  if (value === undefined) return fallback;
  return typeof value === 'string' && POSITIVE_INT.test(value) ? Number(value) : null;
};

// `random` and `sleep` are injectable so tests decide each request's fate
// instead of sampling Math.random() and waiting on real timers.
export function createApp(config, { random = Math.random, sleep = defaultSleep } = {}) {
  const products = generateProducts();
  const app = express();

  // Before any chaos: Docker health checks must not fail at random (spec 005, AK-1.3).
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/products', async (req, res) => {
    const page = parsePositiveInt(req.query.page, 1);
    const pageSize = parsePositiveInt(req.query.pageSize, 100);
    if (page === null || pageSize === null || pageSize > MAX_PAGE_SIZE) {
      return res.status(400).json({
        error: `page and pageSize must be positive integers, pageSize <= ${MAX_PAGE_SIZE}`,
      });
    }

    const { slow, outcome } = rollChaos(config, random);
    if (slow) await sleep(config.slowMs);

    if (outcome === 'rateLimited') {
      return res.status(429).set('Retry-After', '2').json({ error: 'Too Many Requests' });
    }
    if (outcome === 'error') {
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    const start = (page - 1) * pageSize;
    res.json({ items: products.slice(start, start + pageSize), page, pageSize, total: TOTAL });
  });

  return app;
}
