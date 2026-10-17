import type { OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

/** Owns the connection pool; closes it after all beforeApplicationShutdown hooks ran. */
export class Database implements OnApplicationShutdown {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
