import { INestApplication } from '@nestjs/common';
import { HealthCheckError, HttpHealthIndicator } from '@nestjs/terminus';
import request from 'supertest';
import { App } from 'supertest/types';

import { HealthCheckService } from '../src/common/health/health-check.service';
import { HealthStatus } from '../src/common/health/health-check.interface';
import { createTestApp } from './utils/create-test-app';
import {
  DOWNSTREAM_SERVICES,
  buildServiceHealth,
  createFakeHealthCheckService,
  createFakeHttpHealthIndicator,
} from './utils/fake-downstream';

type TerminusBody = {
  status: string;
  info: Record<string, { status: string }>;
  error: Record<string, { status: string }>;
  details: Record<string, { status: string }>;
};

describe('Gateway health (e2e)', () => {
  let app: INestApplication<App>;
  const httpIndicator = createFakeHttpHealthIndicator();
  const healthCheck = createFakeHealthCheckService();

  const getHealth = () => request(app.getHttpServer()).get('/health');

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(HttpHealthIndicator)
        .useValue(httpIndicator)
        .overrideProvider(HealthCheckService)
        .useValue(healthCheck),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    httpIndicator.pingCheck.mockImplementation((key: string) =>
      Promise.resolve({ [key]: { status: 'up' } }),
    );
  });

  describe('GET /health', () => {
    it('retorna 200 e o envelope do Terminus com os 4 downstream up', async () => {
      const res = await getHealth().expect(200);
      const body = res.body as TerminusBody;

      expect(body.status).toBe('ok');
      expect(Object.keys(body.details).sort()).toEqual([
        'checkout-service',
        'payments-service',
        'products-service',
        'users-service',
      ]);
      expect(body.error).toEqual({});
    });

    it('é público: responde sem header Authorization', async () => {
      const res = await getHealth();

      expect(res.status).not.toBe(401);
    });

    // O @SkipThrottle({ short, medium, long }) do controller nomeia os três
    // throttlers do AppModule. Sem os nomes, o rate limit (10 req/s no
    // throttler `short`) derrubaria o /health e um monitor leria o 429 como
    // gateway doente.
    it('não é afetado pelo rate limit: 25 chamadas seguidas, nenhuma 429', async () => {
      // Sequencial de propósito: 25 conexões simultâneas contra o servidor
      // efêmero do supertest derrubam o socket (ECONNRESET) e mascarariam o que
      // o teste quer medir. O throttler `short` permite 10 req/s, então 25
      // chamadas em sequência já estouram o limite se o @SkipThrottle falhar.
      const statuses: number[] = [];
      for (let i = 0; i < 25; i++) {
        statuses.push((await getHealth()).status);
      }

      expect(statuses).not.toContain(429);
      expect(statuses.every((status) => status === 200)).toBe(true);
    });

    it('retorna 503 quando um downstream está fora, identificando qual', async () => {
      // Precisa ser um HealthCheckError: o Terminus só converte a falha em 503
      // quando reconhece o tipo — um Error comum vira 500.
      httpIndicator.pingCheck.mockImplementation((key: string) => {
        if (key === 'products-service') {
          return Promise.reject(
            new HealthCheckError('unreachable', {
              [key]: { status: 'down' },
            }),
          );
        }
        return Promise.resolve({ [key]: { status: 'up' } });
      });

      const res = await getHealth().expect(503);
      const body = res.body as TerminusBody;

      expect(body.status).toBe('error');
      expect(body.details['products-service'].status).toBe('down');
      expect(body.details['users-service'].status).toBe('up');
    });
  });

  describe('GET /health/services', () => {
    it('agrega os 4 serviços e reporta healthy quando todos respondem', async () => {
      healthCheck.checkAllServices.mockResolvedValueOnce(
        DOWNSTREAM_SERVICES.map((name) => buildServiceHealth(name)),
      );

      const res = await request(app.getHttpServer())
        .get('/health/services')
        .expect(200);

      expect(res.body).toMatchObject({
        overallStatus: 'healthy',
        summary: { total: 4, healthy: 4, unhealthy: 0, degraded: 0 },
      });
      expect(res.body.services).toHaveLength(4);
    });

    it('reporta degraded quando parte dos serviços está fora', async () => {
      healthCheck.checkAllServices.mockResolvedValueOnce([
        buildServiceHealth('users'),
        buildServiceHealth('products', HealthStatus.UNHEALTHY),
        buildServiceHealth('checkout'),
        buildServiceHealth('payments', HealthStatus.UNHEALTHY),
      ]);

      const res = await request(app.getHttpServer())
        .get('/health/services')
        .expect(200);

      expect(res.body).toMatchObject({
        overallStatus: 'degraded',
        summary: { total: 4, healthy: 2, unhealthy: 2 },
      });
    });

    it('reporta unhealthy quando nenhum serviço responde', async () => {
      healthCheck.checkAllServices.mockResolvedValueOnce(
        DOWNSTREAM_SERVICES.map((name) =>
          buildServiceHealth(name, HealthStatus.UNHEALTHY),
        ),
      );

      const res = await request(app.getHttpServer())
        .get('/health/services')
        .expect(200);

      expect(res.body).toMatchObject({ overallStatus: 'unhealthy' });
    });
  });

  describe('GET /health/services/:serviceName', () => {
    it('devolve o resultado em cache do serviço consultado', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/services/users')
        .expect(200);

      expect(res.body).toMatchObject({ name: 'users', status: 'healthy' });
    });

    it('devolve status unknown para um serviço nunca checado', async () => {
      healthCheck.getCachedHealth.mockReturnValueOnce(undefined);

      const res = await request(app.getHttpServer())
        .get('/health/services/inexistente')
        .expect(200);

      expect(res.body).toMatchObject({
        status: 'unknown',
        message: 'Service not found or never checked',
      });
    });
  });

  describe('GET /health/ready e /health/live', () => {
    it('ready responde 200 e reporta ready com todos os downstream saudáveis', async () => {
      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(res.body).toMatchObject({ status: 'ready' });
    });

    it('ready reporta not_ready quando algum downstream está fora', async () => {
      healthCheck.checkAllServices.mockResolvedValueOnce([
        buildServiceHealth('users', HealthStatus.UNHEALTHY),
        buildServiceHealth('products'),
        buildServiceHealth('checkout'),
        buildServiceHealth('payments'),
      ]);

      const res = await request(app.getHttpServer())
        .get('/health/ready')
        .expect(200);

      expect(res.body).toMatchObject({ status: 'not_ready' });
    });

    // Liveness não depende de downstream: responde alive mesmo com todos fora.
    it('live responde alive independentemente dos downstream', async () => {
      healthCheck.checkAllServices.mockRejectedValueOnce(
        new Error('all downstream unreachable'),
      );

      const res = await request(app.getHttpServer())
        .get('/health/live')
        .expect(200);

      expect(res.body).toMatchObject({ status: 'alive' });
      expect(typeof res.body.uptime).toBe('number');
    });
  });
});
