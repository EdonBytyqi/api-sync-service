import { ERP_CONFIG_DEFAULTS, loadErpConfig } from './erp-config.js';

describe('loadErpConfig', () => {
  it('AK-8.1 ohne Umgebungsvariablen gelten die Standardwerte', () => {
    expect(loadErpConfig({})).toEqual({
      baseUrl: 'http://localhost:4000',
      timeoutMs: 2000,
      maxAttempts: 5,
      baseDelayMs: 200,
      maxDelayMs: 5000,
      maxRetryAfterMs: 30_000,
    });
    expect(loadErpConfig({})).toEqual(ERP_CONFIG_DEFAULTS);
  });

  it('liest gesetzte Werte und entfernt einen abschliessenden Slash der URL', () => {
    const config = loadErpConfig({
      ERP_BASE_URL: 'https://erp.example.com/api/',
      ERP_TIMEOUT_MS: '50',
      ERP_MAX_ATTEMPTS: '1',
      ERP_BASE_DELAY_MS: '10',
      ERP_MAX_DELAY_MS: '10',
      ERP_MAX_RETRY_AFTER_MS: '1000',
    });

    expect(config).toEqual({
      baseUrl: 'https://erp.example.com/api',
      timeoutMs: 50,
      maxAttempts: 1,
      baseDelayMs: 10,
      maxDelayMs: 10,
      maxRetryAfterMs: 1000,
    });
  });

  it.each([
    ['ERP_BASE_URL', 'localhost:4000'],
    ['ERP_BASE_URL', 'ftp://erp.example.com'],
    ['ERP_BASE_URL', ''],
    ['ERP_TIMEOUT_MS', 'abc'],
    ['ERP_TIMEOUT_MS', '0'],
    ['ERP_TIMEOUT_MS', '-5'],
    ['ERP_TIMEOUT_MS', '1.5'],
    ['ERP_TIMEOUT_MS', '1e3'],
    ['ERP_MAX_ATTEMPTS', '0x10'],
    ['ERP_MAX_ATTEMPTS', ' 5'],
    ['ERP_MAX_RETRY_AFTER_MS', ''],
  ])('AK-8.2 %s=%j wird abgelehnt und benannt', (name, value) => {
    expect(() => loadErpConfig({ [name]: value })).toThrow(
      `${name}=${JSON.stringify(value)}`,
    );
  });

  it('AK-8.2 ERP_MAX_DELAY_MS < ERP_BASE_DELAY_MS wird abgelehnt', () => {
    expect(() =>
      loadErpConfig({ ERP_BASE_DELAY_MS: '500', ERP_MAX_DELAY_MS: '100' }),
    ).toThrow('ERP_MAX_DELAY_MS (100) must be >= ERP_BASE_DELAY_MS (500)');
  });

  it('AK-8.2 meldet alle ungültigen Variablen auf einmal', () => {
    expect(() =>
      loadErpConfig({ ERP_BASE_URL: 'nope', ERP_MAX_ATTEMPTS: 'x' }),
    ).toThrow(/ERP_BASE_URL[\s\S]*ERP_MAX_ATTEMPTS/);
  });
});
