import type {
  BeforeApplicationShutdown,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { SyncLogger } from './sync-runner.js';
import type { SyncService } from './sync.service.js';

export const SYNC_CRON_JOB = 'sync';

/** Starts scheduled runs (AK-8.1); a tick during a running run is skipped. */
export class SyncScheduler
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private job?: CronJob;

  constructor(
    private readonly settings: { cron: string; enabled: boolean },
    private readonly service: Pick<SyncService, 'start'>,
    private readonly registry: Pick<
      SchedulerRegistry,
      'addCronJob' | 'deleteCronJob'
    >,
    private readonly logger: SyncLogger,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.settings.enabled) {
      this.logger.log('scheduled sync disabled (SYNC_SCHEDULE_ENABLED=false)');
      return;
    }
    this.job = CronJob.from({
      cronTime: this.settings.cron,
      onTick: () => void this.tick(),
    });
    this.registry.addCronJob(SYNC_CRON_JOB, this.job);
    this.job.start();
    this.logger.log(`scheduled sync: ${this.settings.cron}`);
  }

  beforeApplicationShutdown(): void {
    if (!this.job) return;
    this.registry.deleteCronJob(SYNC_CRON_JOB); // also stops the job
    this.job = undefined;
  }

  async tick(): Promise<void> {
    try {
      const result = await this.service.start('schedule');
      if (!result.started) {
        // Skipped, not queued: a full sync right after another brings nothing new.
        this.logger.log(
          `scheduled sync skipped: run ${result.runningRunId} is still running`,
        );
      }
    } catch (err) {
      this.logger.error(
        `scheduled sync could not start: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
