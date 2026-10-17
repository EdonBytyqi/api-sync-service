import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  // SIGTERM/SIGINT run the shutdown hooks: running syncs are aborted and
  // recorded as failed before the DB pool closes (spec 003, AK-8.4).
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
