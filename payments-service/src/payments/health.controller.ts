import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

interface HealthResponse {
  status: 'ok';
  database: 'up';
}

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.dataSource.query('SELECT 1');
    } catch (error) {
      this.logger.error('Health check failed: database unavailable', error);

      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }

    return { status: 'ok', database: 'up' };
  }
}
