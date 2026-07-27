import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createTestApp } from './utils/create-test-app';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  const getHealth = () => request(app.getHttpServer()).get('/health');

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA2 — GET /health com o Postgres no ar retorna 200 e reporta o indicador database como up', async () => {
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

  it('CA6 — responde no formato do Terminus, sem o campo "service" do health antigo', async () => {
    // Se o handler estático do AppController tivesse sobrado, o Nest resolveria
    // para ele e o corpo viria { status: 'ok', service: 'users-service' }.
    const res = await getHealth().expect(200);

    expect(res.body).not.toHaveProperty('service');
    expect(res.body).toHaveProperty('details');
  });
});
