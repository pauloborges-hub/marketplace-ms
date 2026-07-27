import {
  HealthCheck,
  HealthCheckService as TerminusHealthCheckService,
  HttpHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Controller, Get, Param } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { HealthCheckService } from 'src/common/health/health-check.service';
import { HealthService } from './health.service';
import { serviceConfig } from 'src/config/gateway.config';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthService: HealthService,
    private readonly healthCheckService: HealthCheckService,
    private readonly health: TerminusHealthCheckService,
    private readonly http: HttpHealthIndicator,
  ) {}

  /**
   * O gateway não tem banco próprio: sua saúde é a dos 4 downstream.
   *
   * timeout de 3s (menor que os 10s de serviceConfig usados no proxy) com os 4
   * indicadores em paralelo mantém o pior caso em ~3s. @SkipThrottle porque um 429
   * do CustomThrottlerGuard seria lido por um monitor como gateway doente.
   */
  @Get()
  @SkipThrottle()
  @HealthCheck()
  @ApiOperation({
    summary: 'Health check do gateway e dos 4 serviços downstream',
  })
  @ApiResponse({ status: 200, description: 'Todos os downstream respondendo' })
  @ApiResponse({
    status: 503,
    description: 'Ao menos um downstream indisponível',
  })
  check() {
    return this.health.check([
      () =>
        this.http.pingCheck(
          'users-service',
          `${serviceConfig.users.url}/health`,
          { timeout: 3000 },
        ),
      () =>
        this.http.pingCheck(
          'products-service',
          `${serviceConfig.products.url}/health`,
          { timeout: 3000 },
        ),
      () =>
        this.http.pingCheck(
          'checkout-service',
          `${serviceConfig.checkout.url}/health`,
          { timeout: 3000 },
        ),
      () =>
        this.http.pingCheck(
          'payments-service',
          `${serviceConfig.payments.url}/health`,
          { timeout: 3000 },
        ),
    ]);
  }

  @Get('services')
  @ApiOperation({ summary: 'Health check de todos os serviços' })
  @ApiResponse({ status: 200, description: 'Status de todos os serviços' })
  async getServicesHealth() {
    const services = await this.healthCheckService.checkAllServices();

    const overallStatus = services.every((s) => s.status === 'healthy')
      ? 'healthy'
      : services.some((s) => s.status === 'healthy')
        ? 'degraded'
        : 'unhealthy';

    return {
      overallStatus,
      timestamp: new Date().toISOString(),
      services,
      summary: {
        total: services.length,
        healthy: services.filter((s) => s.status === 'healthy').length,
        unhealthy: services.filter((s) => s.status === 'unhealthy').length,
        degraded: services.filter((s) => s.status === 'degraded').length,
      },
    };
  }

  @Get('services/:serviceName')
  @ApiOperation({ summary: 'Health check de um serviço específico' })
  @ApiResponse({ status: 200, description: 'Status do serviço' })
  async getServiceHealth(@Param('serviceName') serviceName: string) {
    const cached = this.healthCheckService.getCachedHealth(serviceName);

    if (!cached) {
      return {
        status: 'unknown',
        message: 'Service not found or never checked',
        timestamp: new Date().toISOString(),
      };
    }

    return cached;
  }

  @Get('ready')
  @ApiOperation({ summary: 'Get readiness status' })
  @ApiResponse({
    status: 200,
    description: 'Readiness status retrieved successfully',
  })
  async getReady() {
    return this.healthService.getReadyStatus();
  }

  @Get('live')
  @ApiOperation({ summary: 'Get liveness status' })
  @ApiResponse({
    status: 200,
    description: 'Liveness status retrieved successfully',
  })
  async getLive() {
    return this.healthService.getLiveStatus();
  }
}
