import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthCheckModule } from 'src/common/health/health-check.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * O HttpModule é importado aqui porque o HealthCheckModule, apesar de importá-lo,
 * não o reexporta — sem isso o HttpHealthIndicator do Terminus não resolve o HttpService.
 */
@Module({
  imports: [TerminusModule, HttpModule, HealthCheckModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
