import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';

import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { HealthStatus, ServiceHealth } from './health-check.interface';
import { serviceConfig } from 'src/config/gateway.config';

@Injectable
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);
  private readonly healthCache = new Map<string, ServiceHealth>();

  constructor(
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async checkServiceHealth(
    serviceName: keyof typeof serviceConfig,
  ): Promise<ServiceHealth> {
    const service = serviceConfig[serviceName];
    const startTime = Date.now();

    try {
      await this.circuitBreakerService.executeWithCircuitBreaker(
        async () => {
          const response = await firstValueFrom(
            this.httpService
              .get(`${service.url}/health`, {
                timeout: service.timeout,
              })
              .pipe(timeout(service.timeout)),
          );

          return response.status;
        },
        `health-${serviceName}`,
        { failureThreshold: 5, timeout: 60000, resetTimeout: 30000 },
        async () => {
          throw new Error('Circuit breaker fallback');
        },
      );

      const responseTime = Date.now() - startTime;
      const serviceHealth: ServiceHealth = {
        name: serviceName,
        url: service.url,
        status: HealthStatus.HEALTHY,
        responseTime,
        lastCheck: new Date(),
      };

      this.healthCache.set(serviceName, serviceHealth);

      return serviceHealth;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const serviceHealth: ServiceHealth = {
        name: serviceName,
        url: service.url,
        status: HealthStatus.UNHEALTHY,
        responseTime,
        lastCheck: new Date(),
        error: error.message,
      };
      this.healthCache.set(serviceName, serviceHealth);
      this.logger.error(
        `Health check failed for ${serviceName}`,
        error.message,
      );

      return serviceHealth;
    }
  }

  async checkAllServices(): Promise<ServiceHealth[]> {
    const services: (keyof typeof serviceConfig)[] = [
      'users',
      'products',
      'checkout',
      'payments',
    ];

    const healthChecks = await Promise.allSettled(
      services.map((serviceName) => this.checkServiceHealth(serviceName)),
    );

    return healthChecks.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: services[index],
          url: serviceConfig[services[index]].url,
          status: HealthStatus.UNHEALTHY,
          responseTime: 0,
          lastCheck: new Date(),
          error: result.reason?.message || 'Unknown error',
        };
      }
    });
  }

  getCachedHealth(serviceName: string): ServiceHealth | undefined {
    return this.healthCache.get(serviceName);
  }

  getAllCachedHealth(): ServiceHealth[] {
    return Array.from(this.healthCache.values());
  }
}
