import { ServiceUnavailableException } from '@nestjs/common';
import type { Database } from '../db/database.js';
import { HealthController } from './health.controller.js';

const controllerWith = (query: () => Promise<unknown>) =>
  new HealthController({ pool: { query } } as unknown as Database);

describe('HealthController', () => {
  it('AK-1.1 Datenbank erreichbar → ok', async () => {
    await expect(
      controllerWith(async () => ({ rows: [] })).check(),
    ).resolves.toEqual({
      status: 'ok',
      database: 'up',
    });
  });

  it('AK-1.1 Datenbank nicht erreichbar → 503 mit database: down', async () => {
    const err = await controllerWith(async () => {
      throw new Error('connect ECONNREFUSED');
    })
      .check()
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect((err as ServiceUnavailableException).getStatus()).toBe(503);
    expect((err as ServiceUnavailableException).getResponse()).toEqual({
      status: 'error',
      database: 'down',
    });
  });
});
