import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createTestApp } from './utils/create-test-app';

type HealthBody = {
  status: string;
  info: Record<string, { status: string }>;
  error: Record<string, { status: string }>;
  details: Record<string, { status: string }>;
};

/**
 * O RabbitMQ não é garantido no ambiente de teste — o docker-compose do
 * checkout-service sobe apenas o Postgres. Por isso as asserções aceitam 200 ou
 * 503 e validam o contrato (envelope + as três chaves), exigindo `up` só do
 * banco, que é pré-requisito da suíte e2e.
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA4 — is public: answers without an Authorization header', async () => {
    const res = await request(app.getHttpServer()).get('/health');

    expect(res.status).not.toBe(401);
    expect([200, 503]).toContain(res.status);
  });

  it('CA3/CA6 — returns the terminus envelope with the three indicators', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    const body = res.body as HealthBody;

    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('info');
    expect(body).toHaveProperty('error');
    expect(body).toHaveProperty('details');

    expect(Object.keys(body.details).sort()).toEqual([
      'database',
      'rabbitmq',
      'rabbitmq-channel',
    ]);
  });

  it('reports the database as up while the test Postgres is reachable', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    const body = res.body as HealthBody;

    expect(body.details).toMatchObject({ database: { status: 'up' } });
  });

  it('CA9 — answers in under 5s even with dependencies down', async () => {
    const startedAt = Date.now();

    await request(app.getHttpServer()).get('/health');

    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});
