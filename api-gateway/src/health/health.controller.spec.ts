import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckService as TerminusHealthCheckService,
  HttpHealthIndicator,
} from '@nestjs/terminus';

import { HealthCheckService } from '../common/health/health-check.service';
import {
  HealthStatus,
  ServiceHealth,
} from '../common/health/health-check.interface';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { serviceConfig } from '../config/gateway.config';

const buildServiceHealth = (
  name: string,
  status: HealthStatus = HealthStatus.HEALTHY,
): ServiceHealth =>
  ({
    name,
    url: `http://${name}.invalid`,
    status,
    responseTime: 3,
    lastCheck: new Date('2026-01-01T00:00:00.000Z'),
  }) as ServiceHealth;

describe('HealthController', () => {
  let controller: HealthController;

  const terminusHealth = { check: jest.fn() };
  const http = { pingCheck: jest.fn() };
  const healthCheckService = {
    checkAllServices: jest.fn(),
    getCachedHealth: jest.fn(),
  };
  const healthService = {
    getReadyStatus: jest.fn(),
    getLiveStatus: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: TerminusHealthCheckService, useValue: terminusHealth },
        { provide: HttpHealthIndicator, useValue: http },
        { provide: HealthCheckService, useValue: healthCheckService },
        { provide: HealthService, useValue: healthService },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('check', () => {
    it('delega ao Terminus com um indicador por serviço downstream', async () => {
      terminusHealth.check.mockResolvedValue({ status: 'ok' });

      await controller.check();

      expect(terminusHealth.check).toHaveBeenCalledTimes(1);
      const indicators = terminusHealth.check.mock
        .calls[0][0] as (() => unknown)[];
      expect(indicators).toHaveLength(4);
    });

    it('pinga a rota /health de cada downstream com timeout de 3s', async () => {
      terminusHealth.check.mockImplementation(
        async (indicators: (() => unknown)[]) => {
          for (const indicator of indicators) {
            await indicator();
          }
          return { status: 'ok' };
        },
      );

      await controller.check();

      // O timeout precisa ser menor que os 10s do proxy: assim o /health
      // responde antes de um monitor considerar o gateway travado.
      expect(http.pingCheck).toHaveBeenCalledWith(
        'users-service',
        `${serviceConfig.users.url}/health`,
        { timeout: 3000 },
      );
      expect(http.pingCheck).toHaveBeenCalledWith(
        'products-service',
        `${serviceConfig.products.url}/health`,
        { timeout: 3000 },
      );
      expect(http.pingCheck).toHaveBeenCalledWith(
        'checkout-service',
        `${serviceConfig.checkout.url}/health`,
        { timeout: 3000 },
      );
      expect(http.pingCheck).toHaveBeenCalledWith(
        'payments-service',
        `${serviceConfig.payments.url}/health`,
        { timeout: 3000 },
      );
    });
  });

  describe('getServicesHealth', () => {
    it('reporta healthy e o resumo quando todos os serviços respondem', async () => {
      healthCheckService.checkAllServices.mockResolvedValue([
        buildServiceHealth('users'),
        buildServiceHealth('products'),
      ]);

      const result = await controller.getServicesHealth();

      expect(result).toMatchObject({
        overallStatus: 'healthy',
        summary: { total: 2, healthy: 2, unhealthy: 0, degraded: 0 },
      });
    });

    it('reporta degraded quando parte dos serviços está fora', async () => {
      healthCheckService.checkAllServices.mockResolvedValue([
        buildServiceHealth('users'),
        buildServiceHealth('products', HealthStatus.UNHEALTHY),
      ]);

      const result = await controller.getServicesHealth();

      expect(result).toMatchObject({
        overallStatus: 'degraded',
        summary: { total: 2, healthy: 1, unhealthy: 1 },
      });
    });

    it('reporta unhealthy quando nenhum serviço responde', async () => {
      healthCheckService.checkAllServices.mockResolvedValue([
        buildServiceHealth('users', HealthStatus.UNHEALTHY),
        buildServiceHealth('products', HealthStatus.UNHEALTHY),
      ]);

      const result = await controller.getServicesHealth();

      expect(result).toMatchObject({ overallStatus: 'unhealthy' });
    });
  });

  describe('getServiceHealth', () => {
    it('devolve o resultado em cache do serviço', async () => {
      const cached = buildServiceHealth('users');
      healthCheckService.getCachedHealth.mockReturnValue(cached);

      await expect(controller.getServiceHealth('users')).resolves.toBe(cached);
      expect(healthCheckService.getCachedHealth).toHaveBeenCalledWith('users');
    });

    it('devolve status unknown quando o serviço nunca foi checado', async () => {
      healthCheckService.getCachedHealth.mockReturnValue(undefined);

      await expect(
        controller.getServiceHealth('fantasma'),
      ).resolves.toMatchObject({
        status: 'unknown',
        message: 'Service not found or never checked',
      });
    });
  });

  describe('getReady / getLive', () => {
    it('getReady delega ao HealthService', async () => {
      healthService.getReadyStatus.mockResolvedValue({ status: 'ready' });

      await expect(controller.getReady()).resolves.toMatchObject({
        status: 'ready',
      });
    });

    it('getLive delega ao HealthService', async () => {
      healthService.getLiveStatus.mockResolvedValue({ status: 'alive' });

      await expect(controller.getLive()).resolves.toMatchObject({
        status: 'alive',
      });
    });
  });
});
