import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { PaymentQueueService } from '../src/events/payment-queue/payment-queue.service';
import { ProductsClientService } from '../src/products-client/products-client.service';
import { createTestApp } from './utils/create-test-app';
import { signToken } from './utils/sign-token';

type Auth = { Authorization: string };

describe('Metrics endpoint (e2e)', () => {
  let app: INestApplication<App>;
  const productsClient = { findProduct: jest.fn() };
  const paymentQueue = { publishPaymentOrder: jest.fn() };

  const bearer = (role: 'seller' | 'buyer', userId?: string): Auth => ({
    Authorization: `Bearer ${signToken(role, userId)}`,
  });

  const fetchMetrics = (): request.Test =>
    request(app.getHttpServer()).get('/metrics').expect(200);

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(ProductsClientService)
        .useValue(productsClient)
        .overrideProvider(PaymentQueueService)
        .useValue(paymentQueue),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // CA2 / CA6 — rota pública, 200 e Content-Type do prom-client (fragmentos,
  // pois o Express pode reordenar os parâmetros do header).
  it('exposes GET /metrics publicly with the prometheus content-type (CA2/CA6)', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.headers['content-type']).toContain('version=0.0.4');
    expect(res.headers['content-type']).toContain('charset=utf-8');
  });

  // CA3 / CA4 — TYPE do counter e do histogram com suas linhas derivadas.
  it('exposes the HTTP counter and histogram definitions (CA3/CA4)', async () => {
    // Gera ao menos uma série HTTP antes de raspar as métricas.
    await request(app.getHttpServer())
      .get('/orders')
      .set(bearer('buyer'))
      .expect(200);

    const res = await fetchMetrics();

    expect(res.text).toContain('# TYPE http_requests_total counter');
    expect(res.text).toContain(
      '# TYPE http_request_duration_seconds histogram',
    );
    expect(res.text).toMatch(/http_request_duration_seconds_bucket\{/);
    expect(res.text).toMatch(/http_request_duration_seconds_sum\{/);
    expect(res.text).toMatch(/http_request_duration_seconds_count\{/);
    expect(res.text).toMatch(/method="GET"/);
    expect(res.text).toMatch(/status_code="200"/);
  });

  // CA5 — métricas padrão do Node.js via collectDefaultMetrics.
  it('exposes Node.js default metrics (CA5)', async () => {
    const res = await fetchMetrics();

    expect(res.text).toContain('process_cpu_user_seconds_total');
    expect(res.text).toContain('nodejs_heap_size_total_bytes');
  });

  // CA7 — dois IDs distintos colapsam numa única série route="/orders/:id";
  // nenhum UUID vaza para a label route.
  it('normalizes dynamic route params into a single series (CA7)', async () => {
    const auth = bearer('buyer');
    const id1 = randomUUID();
    const id2 = randomUUID();

    // Pedidos inexistentes retornam 404, mas o padrão de rota é o mesmo — o que
    // importa aqui é a normalização do label, não o status.
    await request(app.getHttpServer()).get(`/orders/${id1}`).set(auth);
    await request(app.getHttpServer()).get(`/orders/${id2}`).set(auth);

    const res = await fetchMetrics();

    expect(res.text).toContain('route="/orders/:id"');
    expect(res.text).not.toContain(`route="/orders/${id1}"`);
    expect(res.text).not.toContain(`route="/orders/${id2}"`);
  });

  // CA8 — o próprio /metrics não se contabiliza a cada scrape.
  it('never records a series for the /metrics route itself (CA8)', async () => {
    await fetchMetrics();
    await fetchMetrics();
    await fetchMetrics();

    const res = await fetchMetrics();

    expect(res.text).not.toContain('route="/metrics"');
  });

  // CA9 — LIMITAÇÃO CONHECIDA: 404 de rota inexistente é servido por
  // setNotFoundHandler (layer use() do Express), fora da cadeia de
  // interceptors, então não é contabilizado. Ver nota na seção 6 da spec 04.
  // A asserção precisa casar a série *daquela rota*: um `status_code="404"`
  // solto já existe neste ponto, gerado pelos GET /orders/:id inexistentes do
  // CA7 — que passam pelo interceptor e são contabilizados normalmente. Sem o
  // label `route`, o `.failing` casava com aquela série e o teste passava,
  // deixando de documentar a limitação.
  it.failing('accounts 404 for unknown routes (CA9)', async () => {
    await request(app.getHttpServer()).get('/rota-que-nao-existe').expect(404);

    const res = await fetchMetrics();

    expect(res.text).toMatch(
      /http_requests_total\{[^}]*route="\/rota-que-nao-existe"[^}]*status_code="404"[^}]*\}/,
    );
  });

  // CA10 — LIMITAÇÃO CONHECIDA: o JwtAuthGuard global (APP_GUARD) roda antes
  // dos interceptors, então um 401 curto-circuita antes do interceptor. Ver
  // nota na seção 6 da spec 04.
  it.failing(
    'accounts 401 for protected routes without token (CA10)',
    async () => {
      await request(app.getHttpServer()).get('/cart').expect(401);

      const res = await fetchMetrics();

      expect(res.text).toMatch(
        /http_requests_total\{[^}]*status_code="401"[^}]*\}/,
      );
    },
  );
});
