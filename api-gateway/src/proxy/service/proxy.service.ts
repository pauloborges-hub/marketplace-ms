import { firstValueFrom } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';

import { CircuitBreakerService } from 'src/common/circuit-breaker/circuit-breaker.service';
import { CacheFallbackService } from 'src/common/fallback/cache.fallback';
import { DefaultFallbackService } from 'src/common/fallback/default.fallback';
import { RetryService } from 'src/common/retry/retry.service';
import { serviceConfig } from 'src/config/gateway.config';
import { TimeoutService } from 'src/common/timeout/timeout.service';

interface UserInfo {
  userId: string;
  email: string;
  role: string;
}

type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly circuitBreakerService: CircuitBreakerService,
    private readonly cacheFallbackService: CacheFallbackService,
    private readonly defaultFallbackService: DefaultFallbackService,
    private readonly timeoutService: TimeoutService,
    private readonly retryService: RetryService,
  ) {}

  async proxyRequest(
    serviceName: keyof typeof serviceConfig,
    method: string,
    path: string,
    data?: unknown,
    headers?: Record<string, string>,
    userInfo?: UserInfo,
  ) {
    const service = serviceConfig[serviceName];
    const url = `${service.url}${path}`;

    this.logger.log(`Proxying ${method} request to ${serviceName}: ${url}`);

    const fallback = this.createServiceFallback(serviceName, method, path);

    return this.circuitBreakerService.executeWithCircuitBreaker(
      async () => {
        return await this.retryService.executeWithExponentialBackoff(
          async () => {
            return await this.timeoutService.executeWithCustomTimeout(
              async () => {
                const enhancedHeaders = {
                  ...headers,
                  'x-user-id': userInfo?.userId,
                  'x-user-email': userInfo?.email,
                  'x-user-role': userInfo?.role,
                };

                const response = await firstValueFrom(
                  this.httpService.request({
                    method: method.toLowerCase() as HttpMethod,
                    url,
                    data,
                    headers: enhancedHeaders,
                    timeout: service.timeout,
                  }),
                );

                if (method.toLowerCase() === 'get') {
                  this.cacheFallbackService.setCachedData(
                    `${serviceName}-${path}`,
                    response.data,
                  );
                }

                return response.data;
              },
              service.timeout,
            );
          },
          4,
        );
      },
      `proxy-${serviceName}`,
      { failureThreshold: 3, timeout: 30000, resetTimeout: 30000 },
      fallback,
    );
  }

  private createServiceFallback(
    serviceName: string,
    method: string,
    path: string,
  ) {
    switch (serviceName) {
      case 'users':
        if (path.includes('/auth/login')) {
          return this.defaultFallbackService.createErrorFallback(
            'users',
            'Authentication service unavailable',
          );
        }

        return this.defaultFallbackService.createErrorFallback(
          'users',
          'User service unavailable',
        );
      case 'products':
        if (method.toLocaleLowerCase() === 'get') {
          return this.cacheFallbackService.createCacheFallback(
            `products-${path}`,
            { products: [], total: 0, page: 1, limit: 10 },
          );
        }

        return this.defaultFallbackService.createErrorFallback(
          'products',
          'Product service unavailable',
        );

      case 'checkout':
      case 'payments':
        return this.defaultFallbackService.createErrorFallback(
          serviceName,
          `${serviceName} service unavailable`,
        );

      default:
        return this.defaultFallbackService.createErrorFallback(
          serviceName,
          'Service unavailable',
        );
    }
  }
}
