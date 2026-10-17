import { loadSyncConfig, SYNC_CONFIG_DEFAULTS } from './sync-config.js';

const DB = { DATABASE_URL: 'postgres://u:p@localhost:5432/sync' };

describe('loadSyncConfig', () => {
  it('AK-9.1 Standardwerte, DATABASE_URL aus der Umgebung', () => {
    expect(loadSyncConfig(DB)).toEqual({
      databaseUrl: DB.DATABASE_URL,
      pageSize: 100,
      cron: '*/15 * * * *',
      scheduleEnabled: true,
      maxConsecutiveFailures: 3,
      maxDeactivateRatio: 0.1,
      staleMarginMs: 60_000,
    });
    expect(loadSyncConfig(DB)).toMatchObject(SYNC_CONFIG_DEFAULTS);
  });

  it('liest gesetzte Werte', () => {
    const config = loadSyncConfig({
      DATABASE_URL: 'postgresql://localhost/sync',
      SYNC_PAGE_SIZE: '1000',
      SYNC_CRON: '0 */2 * * * *',
      SYNC_SCHEDULE_ENABLED: 'false',
      SYNC_MAX_CONSECUTIVE_FAILURES: '5',
      SYNC_MAX_DEACTIVATE_RATIO: '0',
      SYNC_STALE_MARGIN_MS: '1',
    });

    expect(config).toMatchObject({
      pageSize: 1000,
      cron: '0 */2 * * * *',
      scheduleEnabled: false,
      maxConsecutiveFailures: 5,
      maxDeactivateRatio: 0,
      staleMarginMs: 1,
    });
  });

  it('AK-9.1 / AK-9.2 DATABASE_URL ist Pflicht', () => {
    expect(() => loadSyncConfig({})).toThrow('DATABASE_URL is required');
    expect(() => loadSyncConfig({ DATABASE_URL: 'mysql://x' })).toThrow(
      'DATABASE_URL must start with postgres://',
    );
  });

  it.each([
    ['SYNC_PAGE_SIZE', '0'],
    ['SYNC_PAGE_SIZE', '1001'],
    ['SYNC_PAGE_SIZE', '1e2'],
    ['SYNC_CRON', 'every 5 minutes'],
    ['SYNC_CRON', '61 * * * *'],
    ['SYNC_SCHEDULE_ENABLED', 'yes'],
    ['SYNC_SCHEDULE_ENABLED', '1'],
    ['SYNC_MAX_CONSECUTIVE_FAILURES', '0'],
    ['SYNC_MAX_DEACTIVATE_RATIO', '1.5'],
    ['SYNC_MAX_DEACTIVATE_RATIO', '-0.1'],
    ['SYNC_MAX_DEACTIVATE_RATIO', 'abc'],
    ['SYNC_MAX_DEACTIVATE_RATIO', ''],
    ['SYNC_STALE_MARGIN_MS', '-1'],
  ])('AK-9.2 %s=%j wird abgelehnt und benannt', (name, value) => {
    expect(() => loadSyncConfig({ ...DB, [name]: value })).toThrow(
      `${name}=${JSON.stringify(value)}`,
    );
  });

  it('AK-9.2 meldet alle ungültigen Variablen auf einmal', () => {
    expect(() => loadSyncConfig({ SYNC_PAGE_SIZE: '0' })).toThrow(
      /DATABASE_URL[\s\S]*SYNC_PAGE_SIZE/,
    );
  });
});
