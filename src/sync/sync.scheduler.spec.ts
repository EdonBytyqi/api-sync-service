import type { CronJob } from 'cron';
import type { StartResult, SyncRun } from './sync-runs.repository.js';
import { SYNC_CRON_JOB, SyncScheduler } from './sync.scheduler.js';

function setup(
  enabled: boolean,
  startResult: StartResult | Error = {
    started: true,
    run: { id: 1 } as SyncRun,
    abandonedRunIds: [],
  },
) {
  const service = {
    start: vi.fn(async () => {
      if (startResult instanceof Error) throw startResult;
      return startResult;
    }),
  };
  const jobs = new Map<string, CronJob>();
  const registry = {
    addCronJob: vi.fn((name: string, job: CronJob) => void jobs.set(name, job)),
    deleteCronJob: vi.fn((name: string) => {
      void jobs.get(name)?.stop();
      jobs.delete(name);
    }),
  };
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const scheduler = new SyncScheduler(
    { cron: '*/15 * * * *', enabled },
    service,
    registry,
    logger,
  );
  return { scheduler, service, registry, jobs, logger };
}

describe('SyncScheduler', () => {
  it('AK-8.1 registriert und startet den Cron-Job mit SYNC_CRON', () => {
    const { scheduler, jobs } = setup(true);

    scheduler.onApplicationBootstrap();

    const job = jobs.get(SYNC_CRON_JOB)!;
    expect(job.isActive).toBe(true);
    expect(job.cronTime.source).toBe('*/15 * * * *');
    scheduler.beforeApplicationShutdown();
    expect(jobs.size).toBe(0);
    expect(job.isActive).toBe(false);
  });

  it('AK-8.1 SYNC_SCHEDULE_ENABLED=false: kein Job', () => {
    const { scheduler, registry } = setup(false);

    scheduler.onApplicationBootstrap();
    scheduler.beforeApplicationShutdown();

    expect(registry.addCronJob).not.toHaveBeenCalled();
    expect(registry.deleteCronJob).not.toHaveBeenCalled();
  });

  it('AK-8.1 ein Tick startet einen Lauf mit trigger schedule', async () => {
    const { scheduler, service } = setup(true);

    await scheduler.tick();

    expect(service.start).toHaveBeenCalledWith('schedule');
  });

  it('AK-7.1 ein Tick während eines laufenden Laufs wird übersprungen und geloggt', async () => {
    const { scheduler, logger } = setup(true, {
      started: false,
      runningRunId: 4,
    });

    await scheduler.tick();

    expect(logger.log).toHaveBeenCalledWith(
      'scheduled sync skipped: run 4 is still running',
    );
  });

  it('ein Fehler beim Start (z. B. DB weg) wird geloggt, nicht geworfen', async () => {
    const { scheduler, logger } = setup(
      true,
      new Error('connect ECONNREFUSED'),
    );

    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      'scheduled sync could not start: connect ECONNREFUSED',
    );
  });
});
