import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config.js';

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url));

describe('Anforderung 6 – Konfiguration (Laden und Validieren)', () => {
  it('AK-6.1 ohne Umgebungsvariablen gelten die Standardwerte', () => {
    expect(loadConfig({})).toEqual({
      failureRate: 0.2,
      slowRate: 0.1,
      rateLimitRate: 0.05,
      slowMs: 5000,
      port: 4000,
    });
  });

  it('liest gesetzte Werte aus der Umgebung', () => {
    const env = { FAILURE_RATE: '0', SLOW_RATE: '1', RATE_LIMIT_RATE: '0.5', SLOW_MS: '0', PORT: '4001' };

    expect(loadConfig(env)).toEqual({
      failureRate: 0,
      slowRate: 1,
      rateLimitRate: 0.5,
      slowMs: 0,
      port: 4001,
    });
  });

  it.each([
    ['FAILURE_RATE', 'abc'],
    ['FAILURE_RATE', '1.5'],
    ['FAILURE_RATE', '-0.1'],
    ['FAILURE_RATE', ''],
    ['SLOW_RATE', 'NaN'],
    ['RATE_LIMIT_RATE', '20%'],
    ['SLOW_MS', '-1'],
    ['SLOW_MS', '2.5'],
    ['PORT', '0'],
    ['PORT', '70000'],
  ])('AK-6.4 %s=%j wird abgelehnt und benannt', (name, value) => {
    expect(() => loadConfig({ [name]: value })).toThrow(`${name}=${JSON.stringify(value)}`);
  });

  it('AK-6.4 FAILURE_RATE + RATE_LIMIT_RATE > 1 wird abgelehnt', () => {
    expect(() => loadConfig({ FAILURE_RATE: '0.8', RATE_LIMIT_RATE: '0.3' })).toThrow(
      'FAILURE_RATE + RATE_LIMIT_RATE must not exceed 1',
    );
  });

  it('AK-6.4 FAILURE_RATE + RATE_LIMIT_RATE = 1 ist erlaubt', () => {
    expect(() => loadConfig({ FAILURE_RATE: '0.95', RATE_LIMIT_RATE: '0.05' })).not.toThrow();
    expect(() => loadConfig({ FAILURE_RATE: '0.7', RATE_LIMIT_RATE: '0.3' })).not.toThrow();
  });

  it('AK-6.4 meldet alle ungültigen Variablen auf einmal', () => {
    expect(() => loadConfig({ FAILURE_RATE: 'x', PORT: 'y' })).toThrow(/FAILURE_RATE[\s\S]*PORT/);
  });

  it('AK-6.4 der Server startet mit ungültiger Konfiguration nicht', () => {
    const result = spawnSync(process.execPath, [SERVER], {
      env: { ...process.env, FAILURE_RATE: 'abc' },
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('FAILURE_RATE="abc"');
  });
});
