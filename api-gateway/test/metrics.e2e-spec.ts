import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from './../src/app.module';

describe('Metrics (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const getMetrics = () => request(app.getHttpServer()).get('/metrics');

  it('CA2 — GET /metrics retorna 200 com o Content-Type do prom-client', async () => {
    const res = await getMetrics().expect(200);

    // O Express reordena os parâmetros ao aplicar o charset, então o header
    // sai como "text/plain; charset=utf-8; version=0.0.4" — equivalente ao
    // registry.contentType do prom-client.
    const contentType = res.headers['content-type'];

    expect(contentType).toContain('text/plain');
    expect(contentType).toContain('version=0.0.4');
    expect(contentType).toContain('charset=utf-8');
  });

  it('CA6 — GET /metrics sem header Authorization retorna 200, não 401', async () => {
    await getMetrics().expect(200);
  });

  it('CA3 — expõe o counter http_requests_total com labels method, route e status_code', async () => {
    // O /metrics se exclui das próprias métricas, então é preciso gerar
    // tráfego em outra rota antes de haver alguma série com labels.
    await request(app.getHttpServer()).get('/').expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/",status_code="200"\}/,
    );
  });

  it('CA4 — expõe o histogram http_request_duration_seconds com _bucket, _sum e _count', async () => {
    await request(app.getHttpServer()).get('/').expect(200);

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

  it('CA7 — 15 requisições consecutivas a /metrics não retornam 429', async () => {
    for (let i = 0; i < 15; i++) {
      await getMetrics().expect(200);
    }
  });

  it('CA9 — nenhuma série usa route="/metrics"', async () => {
    await getMetrics().expect(200);
    await getMetrics().expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).not.toContain('route="/metrics"');
  });

  it('CA10 — rota inexistente retorna 404 e é contabilizada com status_code="404"', async () => {
    await request(app.getHttpServer()).get('/rota-que-nao-existe').expect(404);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="unmatched",status_code="404"\}/,
    );
  });

  it('CA11 — GET /users/profile sem token retorna 401 e é contabilizada com status_code="401"', async () => {
    await request(app.getHttpServer()).get('/users/profile').expect(401);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(/route="\/users\/profile",status_code="401"/);
  });
});
