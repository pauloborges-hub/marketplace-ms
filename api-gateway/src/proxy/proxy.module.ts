import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';

import { CircuitBreakerModule } from 'src/common/circuit-breaker/circuit-breaker.module';
import { FallbackModule } from 'src/common/fallback/fallback.module';
import { ProxyService } from './service/proxy.service';
import { RetryModule } from 'src/common/retry/retry.module';
import { TimeoutModule } from 'src/common/timeout/timeout.module';

@Module({
  imports: [
    HttpModule,
    CircuitBreakerModule,
    FallbackModule,
    TimeoutModule,
    RetryModule,
  ],
  providers: [ProxyService],
  exports: [ProxyService],
})
export class ProxyModule {}
