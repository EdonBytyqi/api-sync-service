import type { OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';

/** Owns the connection pool; closes it after all beforeApplicationShutdown hooks ran. */
export class Database implements OnApplicationShutdown {
  readonly pool: pg.Pool;

  constructor(connectionString: string) {
    // Fail fast instead of hanging when the DB is gone (health check, AK-1.1).
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      connectionTimeoutMillis: 3000,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
