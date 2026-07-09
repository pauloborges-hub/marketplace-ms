import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CircuitBreakerModule } from './common/circuit-breaker/circuit-breaker.module';
import { CustomThrottlerGuard } from './guards/throttler.guard';
import { FallbackModule } from './common/fallback/fallback.module';
import { HealthModule } from './health/health.module';
import { HealthCheckModule } from './common/health/health-check.module';
import { LoggingMiddleware } from './middleware/logging/logging.middleware';
import { MiddlewareModule } from './middleware/middleware.module';
import { ProductsModule } from './products/products.module';
import { ProxyModule } from './proxy/proxy.module';
import { TimeoutModule } from './common/timeout/timeout.module';
import { RetryModule } from './common/retry/retry.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => [
        {
          name: 'short',
          ttl: 1000, // 1 second
          limit: configService.get<number>('RATE_LIMIT_SHORT', 10), // 10 requests per minute
        },
        {
          name: 'medium',
          ttl: 60000, // 1 minute
          limit: configService.get<number>('RATE_LIMIT_MEDIUM', 100), // 100 requests per minute
        },
        {
          name: 'long',
          ttl: 900000, // 15 minutes
          limit: configService.get<number>('RATE_LIMIT_LONG', 1000), // 1000 requests per minute
        },
      ],
      inject: [ConfigService],
    }),
    ProxyModule,
    MiddlewareModule,
    AuthModule,
    UsersModule,
    ProductsModule,
    HealthModule,
    HealthCheckModule,
    FallbackModule,
    CircuitBreakerModule,
    TimeoutModule,
    RetryModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: CustomThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggingMiddleware).forRoutes('*');
  }
}
