import { MetricsService } from './metrics.service';

describe('MetricsService — métricas de negócio', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  it('CA-5/CA-6 — recordOrderCreated incrementa orders_created_total', async () => {
    metrics.recordOrderCreated();
    metrics.recordOrderCreated();

    const text = await metrics.getMetrics();
    expect(text).toContain('# TYPE orders_created_total counter');
    expect(text).toContain('orders_created_total 2');
  });

  it('CA-5/CA-6 — recordMessagePublished incrementa rabbitmq_messages_published_total{queue}', async () => {
    metrics.recordMessagePublished('payment.order');

    const text = await metrics.getMetrics();
    expect(text).toContain('# TYPE rabbitmq_messages_published_total counter');
    expect(text).toMatch(
      /rabbitmq_messages_published_total\{queue="payment.order"\} 1/,
    );
  });
});
