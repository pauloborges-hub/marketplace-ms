import { Module } from '@nestjs/common';

import { HealthCheckModule } from 'src/common/health/health-check.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [HealthCheckModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
