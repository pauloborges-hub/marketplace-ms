import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { CircuitBreakerModule } from '../circuit-breaker/circuit-breaker.module';
import { HealthCheckService } from './health-check.service';

@Module({
  imports: [HttpModule, CircuitBreakerModule],
  providers: [HealthCheckService],
  exports: [HealthCheckService],
})
export class HealthCheckModule {}
