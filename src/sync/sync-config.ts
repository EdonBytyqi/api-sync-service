import { validateCronExpression } from 'cron';

export interface SyncConfig {
  databaseUrl: string;
  pageSize: number;
  cron: string;
  scheduleEnabled: boolean;
  maxConsecutiveFailures: number;
  maxDeactivateRatio: number;
  staleMarginMs: number;
}

export const SYNC_CONFIG_DEFAULTS: Omit<SyncConfig, 'databaseUrl'> = {
  pageSize: 100,
  cron: '*/15 * * * *',
  scheduleEnabled: true,
  maxConsecutiveFailures: 3,
  maxDeactivateRatio: 0.1,
  staleMarginMs: 60_000,
};

const POSITIVE_INT = /^[1-9]\d*$/;
const MAX_PAGE_SIZE = 1000;

/** Reads and validates the sync settings; reports every invalid variable at once. */
export function loadSyncConfig(
  env: Record<string, string | undefined> = {},
): SyncConfig {
  const errors: string[] = [];
  const d = SYNC_CONFIG_DEFAULTS;

  const readInt = (
    name: string,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER,
  ) => {
    const raw = env[name];
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!POSITIVE_INT.test(raw) || value > max) {
      errors.push(
        `${name}=${JSON.stringify(raw)} must be a positive integer${max < Number.MAX_SAFE_INTEGER ? ` <= ${max}` : ''}`,
      );
    }
    return value;
  };

  const databaseUrl = env.DATABASE_URL ?? '';
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    errors.push(
      env.DATABASE_URL === undefined
        ? 'DATABASE_URL is required'
        : 'DATABASE_URL must start with postgres:// or postgresql://',
    );
  }

  const cron = env.SYNC_CRON ?? d.cron;
  if (!validateCronExpression(cron).valid) {
    errors.push(
      `SYNC_CRON=${JSON.stringify(cron)} is not a valid cron expression`,
    );
  }

  const rawEnabled = env.SYNC_SCHEDULE_ENABLED;
  if (
    rawEnabled !== undefined &&
    rawEnabled !== 'true' &&
    rawEnabled !== 'false'
  ) {
    errors.push(
      `SYNC_SCHEDULE_ENABLED=${JSON.stringify(rawEnabled)} must be true or false`,
    );
  }

  const rawRatio = env.SYNC_MAX_DEACTIVATE_RATIO;
  const maxDeactivateRatio =
    rawRatio === undefined ? d.maxDeactivateRatio : Number(rawRatio);
  if (
    rawRatio !== undefined &&
    (rawRatio.trim() === '' ||
      !(maxDeactivateRatio >= 0 && maxDeactivateRatio <= 1))
  ) {
    errors.push(
      `SYNC_MAX_DEACTIVATE_RATIO=${JSON.stringify(rawRatio)} must be a number between 0 and 1`,
    );
  }

  const config: SyncConfig = {
    databaseUrl,
    pageSize: readInt('SYNC_PAGE_SIZE', d.pageSize, MAX_PAGE_SIZE),
    cron,
    scheduleEnabled:
      rawEnabled === undefined ? d.scheduleEnabled : rawEnabled === 'true',
    maxConsecutiveFailures: readInt(
      'SYNC_MAX_CONSECUTIVE_FAILURES',
      d.maxConsecutiveFailures,
    ),
    maxDeactivateRatio,
    staleMarginMs: readInt('SYNC_STALE_MARGIN_MS', d.staleMarginMs),
  };

  if (errors.length > 0) {
    throw new Error(`Invalid sync configuration:\n  ${errors.join('\n  ')}`);
  }
  return config;
}
