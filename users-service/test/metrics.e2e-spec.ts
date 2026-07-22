import { randomUUID } from 'crypto';

import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createTestApp } from './utils/create-test-app';

describe('Metrics (e2e)', () => {
  let app: INestApplication<App>;

  const getMetrics = () => request(app.getHttpServer()).get('/metrics');

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA2 — GET /metrics retorna 200 com o Content-Type do prom-client', async () => {
    const res = await getMetrics().expect(200);

    // O Express pode reordenar os parâmetros ao aplicar o charset; validamos
    // por fragmentos equivalentes ao registry.contentType do prom-client.
    const contentType = res.headers['content-type'];

    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=0.0.4');
    expect(contentType).toContain('charset=utf-8');
  });

  it('CA6 — GET /metrics sem header Authorization retorna 200 (rota pública sob o guard global)', async () => {
    await getMetrics().expect(200);
  });

  it('CA3 — expõe o counter http_requests_total com labels method, route e status_code', async () => {
    // O /metrics se exclui das próprias métricas, então geramos tráfego em
    // outra rota pública (sem DB) antes de haver alguma série com labels.
    await request(app.getHttpServer()).get('/health').expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/health",status_code="200"\}/,
    );
  });

  it('CA4 — expõe o histogram http_request_duration_seconds com _bucket, _sum e _count', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).toContain(
      '# TYPE http_request_duration_seconds histogram',
    );
    expect(res.text).toContain('http_request_duration_seconds_bucket{');
    expect(res.text).toContain('http_request_duration_seconds_sum{');
    expect(res.text).toContain('http_request_duration_seconds_count{');
  });

  it('CA5 — expõe as métricas padrão do Node.js', async () => {
    const res = await getMetrics().expect(200);

    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('nodejs_heap_size_total_bytes');
  });

  it('CA7 — dois IDs distintos colapsam em route="/users/:id"', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    // Sem token as requisições retornam 401, mas o middleware roda antes do
    // guard e req.route.path já é o padrão /users/:id — o que importa aqui é a
    // normalização do label, não o status.
    await request(app.getHttpServer()).get(`/users/${id1}`);
    await request(app.getHttpServer()).get(`/users/${id2}`);

    const res = await getMetrics().expect(200);

    expect(res.text).toContain('route="/users/:id"');
    expect(res.text).not.toContain(`route="/users/${id1}"`);
    expect(res.text).not.toContain(`route="/users/${id2}"`);
  });

  it('CA8 — nenhuma série usa route="/metrics"', async () => {
    await getMetrics().expect(200);
    await getMetrics().expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).not.toContain('route="/metrics"');
  });

  it('CA9 — rota inexistente retorna 404 e é contabilizada com status_code="404"', async () => {
    await request(app.getHttpServer()).get('/rota-que-nao-existe').expect(404);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="unmatched",status_code="404"\}/,
    );
  });

  it('CA10 — rota protegida sem token retorna 401 e é contabilizada com status_code="401"', async () => {
    await request(app.getHttpServer()).get('/').expect(401);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/",status_code="401"\}/,
    );
  });
});
