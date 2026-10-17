import { Logger, Module } from '@nestjs/common';
import { ErpClient } from './erp-client.js';
import { type ErpConfig, loadErpConfig } from './erp-config.js';

export const ERP_CONFIG = Symbol('ERP_CONFIG');

@Module({
  providers: [
    {
      provide: ERP_CONFIG,
      // Throws on invalid env, which aborts application bootstrap (AK-8.2).
      useFactory: (): ErpConfig => loadErpConfig(process.env),
    },
    {
      provide: ErpClient,
      inject: [ERP_CONFIG],
      useFactory: (config: ErpConfig) => {
        const logger = new Logger(ErpClient.name);
        return new ErpClient(config, {
          logger: {
            warn: (message, context) =>
              logger.warn(`${message} ${JSON.stringify(context)}`),
          },
        });
      },
    },
  ],
  exports: [ErpClient, ERP_CONFIG],
})
export class ErpModule {}
