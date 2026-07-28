import { HealthIndicatorResult } from '@nestjs/terminus';

import {
  HealthStatus,
  ServiceHealth,
} from '../../src/common/health/health-check.interface';

export const DOWNSTREAM_SERVICES = [
  'users',
  'products',
  'checkout',
  'payments',
] as const;

/**
 * Dublê do HttpHealthIndicator do Terminus, usado pelo GET /health.
 *
 * O indicador real faz um GET em `<downstream>/health`; sem os serviços no ar a
 * resposta seria 503 e o teste dependeria do que está rodando na máquina.
 */
export function createFakeHttpHealthIndicator() {
  return {
    pingCheck: jest
      .fn()
      .mockImplementation((key: string): Promise<HealthIndicatorResult> =>
        Promise.resolve({ [key]: { status: 'up' } }),
      ),
  };
}

export function buildServiceHealth(
  name: string,
  status: HealthStatus = HealthStatus.HEALTHY,
): ServiceHealth {
  return {
    name,
    url: `http://${name}-service.invalid`,
    status,
    responseTime: 5,
    lastCheck: new Date(),
  } as ServiceHealth;
}

/**
 * Dublê do HealthCheckService do gateway, usado por /health/services,
 * /health/services/:name e /health/ready.
 */
export function createFakeHealthCheckService() {
  const cache = new Map<string, ServiceHealth>(
    DOWNSTREAM_SERVICES.map((name) => [name, buildServiceHealth(name)]),
  );

  return {
    checkAllServices: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(DOWNSTREAM_SERVICES.map((name) => cache.get(name)!)),
      ),
    checkServiceHealth: jest
      .fn()
      .mockImplementation((name: string) =>
        Promise.resolve(cache.get(name) ?? buildServiceHealth(name)),
      ),
    getCachedHealth: jest
      .fn()
      .mockImplementation((name: string) => cache.get(name)),
    getAllCachedHealth: jest
      .fn()
      .mockImplementation(() => Array.from(cache.values())),
  };
}
