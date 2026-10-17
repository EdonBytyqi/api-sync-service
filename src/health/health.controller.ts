import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Database } from '../db/database.js';

/**
 * Liveness for Docker/orchestrators (spec 005, AK-1.1). Checks the database
 * only: the ERP is unreliable by nature, and a health check that follows it
 * would get a healthy service restarted over and over (AK-1.2).
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(Database) private readonly db: Database) {}

  @Get()
  async check() {
    try {
      await this.db.pool.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }
  }
}
