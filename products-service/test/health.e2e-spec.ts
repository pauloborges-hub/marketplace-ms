import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createTestApp } from './utils/create-test-app';

// Requer o Postgres da porta 5436 no ar (docker compose up -d products-db).
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  const getHealth = () => request(app.getHttpServer()).get('/health');

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA2 — GET /health retorna 200 com o banco up em info e details', async () => {
    const res = await getHealth().expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: { database: { status: 'up' } },
    });
  });

  it('CA3 — GET /health sem header Authorization retorna 200 (rota pública sob o guard global)', async () => {
    await getHealth().expect(200);
  });
});
