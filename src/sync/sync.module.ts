import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  Module,
} from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Database } from '../db/database.js';
import { HealthController } from '../health/health.controller.js';
import { abortableSleep, ErpClient } from '../erp/erp-client.js';
import type { ErpConfig } from '../erp/erp-config.js';
import { ERP_CONFIG, ErpModule } from '../erp/erp.module.js';
import { ProductsRepository } from './products.repository.js';
import { loadSyncConfig, type SyncConfig } from './sync-config.js';
import { SyncRunner } from './sync-runner.js';
import { SyncRunsRepository } from './sync-runs.repository.js';
import { SyncController } from './sync.controller.js';
import { SyncScheduler } from './sync.scheduler.js';
import { SyncService } from './sync.service.js';

export const SYNC_CONFIG = Symbol('SYNC_CONFIG');

const logger = new Logger('Sync');

/** Stops this instance's runs before the pool closes (AK-8.4). */
@Injectable()
class SyncShutdown implements BeforeApplicationShutdown {
  constructor(@Inject(SyncService) private readonly service: SyncService) {}

  async beforeApplicationShutdown(): Promise<void> {
    await this.service.stopAll('shutdown');
  }
}

@Module({
  imports: [ErpModule, ScheduleModule.forRoot()],
  controllers: [SyncController, HealthController],
  providers: [
    {
      provide: SYNC_CONFIG,
      // Throws on invalid env, which aborts bootstrap (AK-9.2).
      useFactory: (): SyncConfig => loadSyncConfig(process.env),
    },
    {
      provide: Database,
      inject: [SYNC_CONFIG],
      useFactory: (config: SyncConfig) => new Database(config.databaseUrl),
    },
    {
      provide: SyncRunsRepository,
      inject: [Database],
      useFactory: (db: Database) => new SyncRunsRepository(db.pool),
    },
    {
      provide: ProductsRepository,
      inject: [Database],
      useFactory: (db: Database) => new ProductsRepository(db.pool),
    },
    {
      provide: SyncRunner,
      inject: [SYNC_CONFIG, ErpClient, SyncRunsRepository, ProductsRepository],
      useFactory: (
        config: SyncConfig,
        source: ErpClient,
        runs: SyncRunsRepository,
        products: ProductsRepository,
      ) =>
        new SyncRunner(config, {
          source,
          runs,
          products,
          sleep: abortableSleep,
          logger,
        }),
    },
    {
      provide: SyncService,
      inject: [SYNC_CONFIG, ERP_CONFIG, SyncRunsRepository, SyncRunner],
      useFactory: (
        config: SyncConfig,
        erpConfig: ErpConfig,
        runs: SyncRunsRepository,
        runner: SyncRunner,
      ) =>
        new SyncService(
          {
            pageSize: config.pageSize,
            staleAfterMs:
              ErpClient.maxDurationMs(erpConfig) + config.staleMarginMs,
          },
          runs,
          runner,
          logger,
        ),
    },
    {
      provide: SyncScheduler,
      inject: [SYNC_CONFIG, SyncService, SchedulerRegistry],
      useFactory: (
        config: SyncConfig,
        service: SyncService,
        registry: SchedulerRegistry,
      ) =>
        new SyncScheduler(
          { cron: config.cron, enabled: config.scheduleEnabled },
          service,
          registry,
          logger,
        ),
    },
    SyncShutdown,
  ],
  exports: [SyncService],
})
export class SyncModule {}
