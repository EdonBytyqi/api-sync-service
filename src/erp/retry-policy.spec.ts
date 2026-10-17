import { ERP_CONFIG_DEFAULTS } from './erp-config.js';
import {
  type AttemptOutcome,
  backoffDelay,
  classify,
  parseRetryAfter,
  retryDelay,
  type Verdict,
} from './retry-policy.js';

const config = ERP_CONFIG_DEFAULTS; // baseDelayMs 200, maxDelayMs 5000
const http = (status: number, retryAfter?: string): AttemptOutcome => ({
  kind: 'http',
  status,
  retryAfter,
});

describe('classify (Tabelle aus design.md)', () => {
  it.each<[string, AttemptOutcome, Verdict]>([
    ['Erfolg', { kind: 'success' }, 'success'],
    ['ungültige Antwort', { kind: 'invalidResponse' }, 'fail'],
    ['Netzwerkfehler', { kind: 'network' }, 'retry'],
    ['Timeout', { kind: 'timeout' }, 'retry'],
    ['408', http(408), 'retry'],
    ['429', http(429), 'retry'],
    ['500', http(500), 'retry'],
    ['502', http(502), 'retry'],
    ['503', http(503), 'retry'],
    ['504', http(504), 'retry'],
    ['400', http(400), 'fail'],
    ['401', http(401), 'fail'],
    ['403', http(403), 'fail'],
    ['404', http(404), 'fail'],
    ['422', http(422), 'fail'],
    ['501', http(501), 'fail'],
    ['505', http(505), 'fail'],
  ])('AK-3.1 / AK-5.1 / AK-5.2 %s → %s', (_, outcome, verdict) => {
    expect(classify(outcome)).toBe(verdict);
  });
});

describe('backoffDelay', () => {
  it('AK-3.2 die Obergrenzen verdoppeln sich: 200, 400, 800, 1600 ms', () => {
    const caps = [1, 2, 3, 4].map((n) => backoffDelay(n, config, () => 1));
    expect(caps).toEqual([200, 400, 800, 1600]);
  });

  it('AK-3.3 mit random() = 0.5 sind es 100, 200, 400, 800 ms', () => {
    const delays = [1, 2, 3, 4].map((n) => backoffDelay(n, config, () => 0.5));
    expect(delays).toEqual([100, 200, 400, 800]);
  });

  it('AK-3.2 Full Jitter: random() = 0 ergibt 0 ms', () => {
    expect(backoffDelay(3, config, () => 0)).toBe(0);
  });

  it('AK-3.4 ab Versuch 6 ist die Obergrenze maxDelayMs', () => {
    // 200 × 2^5 = 6400 > 5000
    expect(backoffDelay(6, config, () => 1)).toBe(5000);
    expect(backoffDelay(50, config, () => 0.5)).toBe(2500);
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-21T07:28:00Z');

  it('AK-4.1 Sekunden werden zu Millisekunden', () => {
    expect(parseRetryAfter('2', now)).toBe(2000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
  });

  it('AK-4.2 ein HTTP-Datum in der Zukunft ergibt die Differenz zu now()', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:03 GMT', now)).toBe(3000);
  });

  it('AK-4.2 ein HTTP-Datum in der Vergangenheit ergibt 0', () => {
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:27:00 GMT', now)).toBe(0);
  });

  it.each([
    ['fehlt (null)', null],
    ['fehlt (undefined)', undefined],
    ['leer', ''],
    ['Text', 'abc'],
    ['negativ', '-1'],
    ['Dezimalzahl', '1.5'],
    ['Einheit', '5s'],
    ['ISO-Datum statt HTTP-Datum', '2026-10-21T07:28:03Z'],
    ['RFC-850-Datum (nicht unterstützt)', 'Wednesday, 21-Oct-26 07:28:03 GMT'],
  ])('AK-4.3 %s → undefined (Backoff)', (_, header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined();
  });
});

describe('retryDelay', () => {
  const random = () => 0.5;

  it('AK-4.1 429 mit Retry-After nutzt den Header', () => {
    expect(retryDelay(http(429, '2'), 1, config, random, 0)).toEqual({
      delayMs: 2000,
      source: 'retryAfter',
    });
  });

  it('AK-4.6 503 mit Retry-After nutzt den Header', () => {
    expect(retryDelay(http(503, '7'), 1, config, random, 0).delayMs).toBe(7000);
  });

  it('AK-4.3 429 ohne gültigen Header nutzt den Backoff', () => {
    expect(retryDelay(http(429, 'abc'), 2, config, random, 0)).toEqual({
      delayMs: 200,
      source: 'backoff',
    });
  });

  it('500 ignoriert Retry-After und nutzt den Backoff', () => {
    expect(retryDelay(http(500, '2'), 1, config, random, 0).source).toBe(
      'backoff',
    );
  });
});
