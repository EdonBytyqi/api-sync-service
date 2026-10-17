import {
  BadRequestException,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { type SyncRun, SyncRunsRepository } from './sync-runs.repository.js';
import { SyncService } from './sync.service.js';

const POSITIVE_INT = /^[1-9]\d*$/;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

@Controller('sync')
export class SyncController {
  constructor(
    @Inject(SyncService) private readonly service: SyncService,
    @Inject(SyncRunsRepository) private readonly runs: SyncRunsRepository,
  ) {}

  /** Starts a run and returns at once (AK-8.2), or 409 if one is running (AK-8.3). */
  @Post()
  @HttpCode(202)
  async start(@Res({ passthrough: true }) res: Response) {
    const result = await this.service.start('manual');
    if (!result.started) {
      throw new ConflictException({
        error: 'a sync run is already running',
        runningRunId: result.runningRunId,
      });
    }
    const { id, status, trigger } = result.run;
    res.setHeader('Location', `/sync/runs/${id}`);
    return { id, status, trigger };
  }

  @Get('runs')
  list(@Query('limit') limit?: string): Promise<SyncRun[]> {
    if (limit === undefined) return this.runs.list(DEFAULT_LIMIT);
    if (!POSITIVE_INT.test(limit) || Number(limit) > MAX_LIMIT) {
      throw new BadRequestException(
        `limit must be an integer between 1 and ${MAX_LIMIT}`,
      );
    }
    return this.runs.list(Number(limit));
  }

  @Get('runs/:id')
  async get(@Param('id') id: string): Promise<SyncRun> {
    if (!POSITIVE_INT.test(id))
      throw new BadRequestException('id must be a positive integer');
    const run = await this.runs.findById(Number(id));
    if (!run) throw new NotFoundException(`sync run ${id} not found`);
    return run;
  }
}
