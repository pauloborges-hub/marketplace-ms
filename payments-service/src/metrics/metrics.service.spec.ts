import { PaymentStatus } from '../payments/entities/payment.entity';
import { MetricsService } from './metrics.service';

describe('MetricsService — métricas de negócio', () => {
  let metrics: MetricsService;

  beforeEach(() => {
    metrics = new MetricsService();
  });

  afterEach(() => {
    metrics.onModuleDestroy();
  });

  it('CA-2 — pagamento aprovado incrementa processed e approved, e não rejected', async () => {
    metrics.recordPaymentProcessed(PaymentStatus.APPROVED);

    const text = await metrics.getMetrics();
    expect(text).toContain('payments_processed_total 1');
    expect(text).toContain('payments_approved_total 1');
    expect(text).not.toMatch(/payments_rejected_total\{/);
  });

  it('CA-3 — pagamento rejeitado incrementa processed e rejected{reason}, e não approved', async () => {
    metrics.recordPaymentProcessed(PaymentStatus.REJECTED, 'Limite excedido');

    const text = await metrics.getMetrics();
    expect(text).toContain('payments_processed_total 1');
    expect(text).toMatch(/payments_rejected_total\{reason="Limite excedido"\} 1/);
    expect(text).toContain('payments_approved_total 0');
  });

  it('CA-3 — rejeição sem motivo cai para reason="unknown"', async () => {
    metrics.recordPaymentProcessed(PaymentStatus.REJECTED, null);

    const text = await metrics.getMetrics();
    expect(text).toMatch(/payments_rejected_total\{reason="unknown"\} 1/);
  });

  it('CA-2/CA-3 — invariante: processed == approved + soma dos rejected', async () => {
    metrics.recordPaymentProcessed(PaymentStatus.APPROVED);
    metrics.recordPaymentProcessed(PaymentStatus.REJECTED, 'Saldo insuficiente');
    metrics.recordPaymentProcessed(PaymentStatus.REJECTED, 'Saldo insuficiente');

    const text = await metrics.getMetrics();
    expect(text).toContain('payments_processed_total 3');
    expect(text).toContain('payments_approved_total 1');
    expect(text).toMatch(/payments_rejected_total\{reason="Saldo insuficiente"\} 2/);
  });
});
