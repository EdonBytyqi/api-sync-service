import express from 'express';

const PORT = Number(process.env.PORT ?? 4000);
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? 0.2);
const SLOW_RATE = Number(process.env.SLOW_RATE ?? 0.1);
const RATE_LIMIT_RATE = Number(process.env.RATE_LIMIT_RATE ?? 0.05);
const SLOW_MS = Number(process.env.SLOW_MS ?? 5000);
const TOTAL = 10_000;
const MAX_PAGE_SIZE = 1000;

// Deterministic catalogue: same ids, order and values on every start.
// Prices are integer cents to avoid floating-point rounding errors with money.
const BASE_TIME = Date.UTC(2026, 0, 1);
const products = Array.from({ length: TOTAL }, (_, i) => {
  const n = i + 1;
  return {
    id: n,
    sku: `SKU-${String(n).padStart(5, '0')}`,
    name: `Product ${n}`,
    priceCents: 100 + ((n * 7919) % 99_900),
    updatedAt: new Date(BASE_TIME + n * 60_000).toISOString(),
  };
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parsePositiveInt = (value, fallback) => {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const app = express();

app.get('/products', async (req, res) => {
  const page = parsePositiveInt(req.query.page, 1);
  const pageSize = parsePositiveInt(req.query.pageSize, 100);
  if (page === null || pageSize === null || pageSize > MAX_PAGE_SIZE) {
    return res.status(400).json({
      error: `page and pageSize must be positive integers, pageSize <= ${MAX_PAGE_SIZE}`,
    });
  }

  if (Math.random() < SLOW_RATE) await sleep(SLOW_MS);

  // One roll for both errors so the rates don't overlap: 5% -> 429, next 20% -> 500.
  const roll = Math.random();
  if (roll < RATE_LIMIT_RATE) {
    return res.status(429).set('Retry-After', '2').json({ error: 'Too Many Requests' });
  }
  if (roll < RATE_LIMIT_RATE + FAILURE_RATE) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }

  const start = (page - 1) * pageSize;
  res.json({ items: products.slice(start, start + pageSize), page, pageSize, total: TOTAL });
});

app.listen(PORT, () => {
  console.log(
    `mock-erp on :${PORT} (failure=${FAILURE_RATE}, slow=${SLOW_RATE}, rateLimit=${RATE_LIMIT_RATE})`,
  );
});
