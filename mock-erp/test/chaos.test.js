import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, rollChaos } from '../app.js';
import {
  defaultConfig,
  ERROR,
  noSleep,
  NOT_SLOW,
  OK,
  RATE_LIMITED,
  sequence,
  SLOW,
  stableConfig,
} from './helpers.js';

const get = (app) => request(app).get('/products?page=1&pageSize=10');

// 1000 evenly spaced values in [0, 1): a perfectly uniform "random" source.
// Every rate must then hit its exact share, with no flakiness.
const uniform = (n = 1000) => Array.from({ length: n }, (_, i) => (i + 0.5) / n);

function countOutcomes(config, values) {
  const counts = { ok: 0, error: 0, rateLimited: 0, slow: 0 };
  for (const v of values) {
    // Same value for both draws: each test sets only the rate it measures.
    const { slow, outcome } = rollChaos(config, sequence(v, v));
    counts[outcome]++;
    if (slow) counts.slow++;
  }
  return counts;
}

describe('Anforderung 3 – Serverfehler (500)', () => {
  it('AK-3.1 ein simulierter Serverfehler liefert 500 mit error und ohne items', async () => {
    const res = await get(createApp(defaultConfig(), { random: sequence(NOT_SLOW, ERROR) }));

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal Server Error' });
  });

  it('AK-3.2 FAILURE_RATE=0.2 ergibt genau 20 % Fehler bei gleichverteiltem Zufall', () => {
    const counts = countOutcomes(stableConfig({ failureRate: 0.2 }), uniform());

    expect(counts).toEqual({ ok: 800, error: 200, rateLimited: 0, slow: 0 });
  });
});

describe('Anforderung 4 – Langsame Antworten', () => {
  it('AK-4.1 eine langsame Antwort wartet SLOW_MS vor der Antwort', async () => {
    const sleep = noSleep();
    const res = await get(createApp(defaultConfig(), { random: sequence(SLOW, OK), sleep }));

    expect(res.status).toBe(200);
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5000);
  });

  it('AK-4.1 mit echtem Timer kommt die Antwort frühestens nach SLOW_MS', async () => {
    const app = createApp(stableConfig({ slowRate: 1, slowMs: 50 }));
    const start = performance.now();
    const res = await get(app);

    expect(res.status).toBe(200);
    // Small tolerance: Node timers may fire up to ~1 ms early.
    expect(performance.now() - start).toBeGreaterThanOrEqual(49);
  });

  it.each([
    [500, ERROR],
    [429, RATE_LIMITED],
    [200, OK],
  ])('AK-4.2 eine langsame Antwort kann mit %i enden', async (status, roll) => {
    const sleep = noSleep();
    const res = await get(createApp(defaultConfig(), { random: sequence(SLOW, roll), sleep }));

    expect(sleep).toHaveBeenCalledOnce();
    expect(res.status).toBe(status);
  });

  it('AK-4.3 SLOW_RATE=0.1 verzögert genau 10 % bei gleichverteiltem Zufall', () => {
    const counts = countOutcomes(stableConfig({ slowRate: 0.1 }), uniform());

    expect(counts.slow).toBe(100);
  });

  it('eine schnelle Antwort wartet nicht', async () => {
    const sleep = noSleep();
    await get(createApp(defaultConfig(), { random: sequence(NOT_SLOW, OK), sleep }));

    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('Anforderung 5 – Rate Limiting (429)', () => {
  it('AK-5.1 ein simuliertes Rate Limit liefert 429 mit Retry-After: 2', async () => {
    const res = await get(createApp(defaultConfig(), { random: sequence(NOT_SLOW, RATE_LIMITED) }));

    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('2');
    expect(res.body).toEqual({ error: 'Too Many Requests' });
  });

  it('AK-5.2 RATE_LIMIT_RATE=0.05 ergibt genau 5 % 429 bei gleichverteiltem Zufall', () => {
    const counts = countOutcomes(stableConfig({ rateLimitRate: 0.05 }), uniform());

    expect(counts).toEqual({ ok: 950, error: 0, rateLimited: 50, slow: 0 });
  });

  it('AK-5.3 500 und 429 schliessen sich aus und ihre Raten addieren sich', () => {
    const counts = countOutcomes(defaultConfig({ slowRate: 0 }), uniform());

    expect(counts).toEqual({ ok: 750, error: 200, rateLimited: 50, slow: 0 });
  });

  it.each([
    [0.0499, 'rateLimited'],
    [0.05, 'error'],
    [0.2499, 'error'],
    [0.25, 'ok'],
  ])('AK-5.3 Grenzwert %f ergibt %s', (roll, expected) => {
    expect(rollChaos(defaultConfig(), sequence(NOT_SLOW, roll)).outcome).toBe(expected);
  });
});

describe('Anforderung 6 – Konfiguration (Verhalten)', () => {
  it('AK-6.2 mit allen Raten 0 antwortet jede Anfrage mit 200, ohne zu warten', async () => {
    // Asserts "never sleeps" instead of timing against the real clock,
    // which is flaky on slow CI machines and doesn't test the intent.
    const sleep = noSleep();
    const app = createApp(stableConfig(), { sleep }); // real Math.random
    for (let i = 0; i < 50; i++) {
      expect((await get(app)).status).toBe(200);
    }
    expect(sleep).not.toHaveBeenCalled();
  });

  it.each([
    ['failureRate', 500],
    ['rateLimitRate', 429],
  ])('AK-6.3 %s=1 trifft jede Anfrage', async (key, status) => {
    const app = createApp(stableConfig({ [key]: 1 })); // real Math.random
    for (let i = 0; i < 50; i++) {
      expect((await get(app)).status).toBe(status);
    }
  });

  it('AK-6.3 slowRate=1 verzögert jede Anfrage', async () => {
    const sleep = noSleep();
    const app = createApp(stableConfig({ slowRate: 1 }), { sleep }); // real Math.random
    for (let i = 0; i < 50; i++) await get(app);

    expect(sleep).toHaveBeenCalledTimes(50);
  });

  it('Standard-Zufallsquelle ist Math.random: Raten stimmen über 10000 Würfe ungefähr', () => {
    // Sanity check of the wiring, not of the rates (those are tested exactly above).
    // Tolerance is > 10 standard deviations, so this practically never flakes.
    const n = 10_000;
    const counts = { ok: 0, error: 0, rateLimited: 0, slow: 0 };
    for (let i = 0; i < n; i++) {
      const { slow, outcome } = rollChaos(defaultConfig(), Math.random);
      counts[outcome]++;
      if (slow) counts.slow++;
    }

    expect(counts.error / n).toBeCloseTo(0.2, 1);
    expect(counts.rateLimited / n).toBeCloseTo(0.05, 1);
    expect(counts.slow / n).toBeCloseTo(0.1, 1);
  });
});

describe('GET /health (Spec 005, AK-1.3)', () => {
  it('antwortet immer sofort mit 200, auch wenn jede Produkt-Anfrage scheitern würde', async () => {
    const random = sequence(); // throws if drawn at all
    const sleep = noSleep();
    const app = createApp(stableConfig({ failureRate: 1, slowRate: 1 }), { random, sleep });

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(random).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});
