import { randomUUID } from 'crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import {
  ConsumerMetrics,
  PaymentConsumerService,
} from '../src/events/payment-consumer/payment-consumer.service';
import { RabbitmqService } from '../src/events/rabbitmq/rabbitmq.service';

describe('Metrics (e2e)', () => {
  let app: INestApplication<App>;

  // Estatísticas fixas do consumer, para as rotas /consumer-metrics não
  // dependerem de nenhuma conexão viva ao RabbitMQ.
  const consumerMetrics: ConsumerMetrics = {
    totalProcessed: 5,
    totalSuccess: 4,
    totalFailed: 1,
    totalRetries: 0,
    lastProcessedAt: new Date(),
    startedAt: new Date(),
    averageProcessingTime: 123,
  };

  const paymentConsumer = {
    onModuleInit: jest.fn(),
    getMetrics: jest.fn(() => consumerMetrics),
    resetMetrics: jest.fn(),
  };

  const rabbitmq = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
  };

  const getMetrics = () => request(app.getHttpServer()).get('/metrics');

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Evita conexões vivas ao RabbitMQ no boot e provê estatísticas
      // determinísticas para as rotas /consumer-metrics.
      .overrideProvider(RabbitmqService)
      .useValue(rabbitmq)
      .overrideProvider(PaymentConsumerService)
      .useValue(paymentConsumer)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
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

  it('CA8 — GET /metrics sem header Authorization retorna 200', async () => {
    await getMetrics().expect(200);
  });

  it('CA3 — expõe o counter http_requests_total com labels method, route e status_code', async () => {
    // O /metrics se exclui das próprias métricas, então geramos tráfego em
    // outra rota antes de haver alguma série com labels.
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

  it('CA6 — GET /consumer-metrics retorna o JSON de ConsumerMetrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/consumer-metrics')
      .expect(200);

    expect(res.body).toMatchObject({
      totalProcessed: 5,
      totalSuccess: 4,
      totalFailed: 1,
      successRate: '80.00%',
      status: 'active',
    });
    expect(res.body.uptime).toBeDefined();
  });

  it('CA7 — sub-rotas de /consumer-metrics funcionam como antes', async () => {
    await request(app.getHttpServer())
      .get('/consumer-metrics/health')
      .expect(200);
    await request(app.getHttpServer())
      .get('/consumer-metrics/summary')
      .expect(200);

    await request(app.getHttpServer())
      .post('/consumer-metrics/reset')
      .expect(201);

    expect(paymentConsumer.resetMetrics).toHaveBeenCalled();
  });

  it('CA9 — dois orderIds distintos colapsam em route="/payments/:orderId"', async () => {
    const id1 = randomUUID();
    const id2 = randomUUID();

    // Pedidos inexistentes retornam 404, mas o padrão de rota é o mesmo — o que
    // importa aqui é a normalização do label, não o status.
    await request(app.getHttpServer()).get(`/payments/${id1}`);
    await request(app.getHttpServer()).get(`/payments/${id2}`);

    const res = await getMetrics().expect(200);

    expect(res.text).toContain('route="/payments/:orderId"');
    expect(res.text).not.toContain(`route="/payments/${id1}"`);
    expect(res.text).not.toContain(`route="/payments/${id2}"`);
  });

  it('CA10 — nenhuma série usa route="/metrics"', async () => {
    await getMetrics().expect(200);
    await getMetrics().expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).not.toContain('route="/metrics"');
  });

  it('CA11 — GET /consumer-metrics é contabilizado com route="/consumer-metrics"', async () => {
    await request(app.getHttpServer()).get('/consumer-metrics').expect(200);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/consumer-metrics",status_code="200"\}/,
    );
  });

  it('CA12 — rota inexistente retorna 404 e é contabilizada com status_code="404"', async () => {
    await request(app.getHttpServer()).get('/rota-que-nao-existe').expect(404);

    const res = await getMetrics().expect(200);

    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="unmatched",status_code="404"\}/,
    );
  });
});
