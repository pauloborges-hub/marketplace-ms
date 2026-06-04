import { Module } from '@nestjs/common';

import { HealthCheckService } from 'src/common/health/health-check.service';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [HealthCheckService],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
