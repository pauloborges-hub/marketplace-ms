import { FakePaymentGatewayService } from './fake-payment-gateway.service';

describe('FakePaymentGatewayService', () => {
  let gateway: FakePaymentGatewayService;

  beforeEach(() => {
    gateway = new FakePaymentGatewayService();

    // Elimina a latência artificial para manter os testes rápidos.
    jest
      .spyOn(global, 'setTimeout')
      .mockImplementation((cb: (...args: unknown[]) => void) => {
        cb();
        return 0 as unknown as NodeJS.Timeout;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('RN1/CA3 — rejeita amount > 10000 com "Limite excedido"', async () => {
    const result = await gateway.process(10000.01);

    expect(result.approved).toBe(false);
    expect(result.rejectionReason).toBe('Limite excedido');
  });

  it('RN2/CA4 — rejeita amount terminado em .99 com "Cartão recusado pela operadora"', async () => {
    const result = await gateway.process(149.99);

    expect(result.approved).toBe(false);
    expect(result.rejectionReason).toBe('Cartão recusado pela operadora');
  });

  it('RN3/CA6 — quando cabe em RN1 e RN2 (ex.: 10000.99), "Limite excedido" tem precedência', async () => {
    const result = await gateway.process(10000.99);

    expect(result.approved).toBe(false);
    expect(result.rejectionReason).toBe('Limite excedido');
  });

  it('RN4/CA5 — aprova valores fora das regras de rejeição, sem rejectionReason', async () => {
    const result = await gateway.process(150.5);

    expect(result.approved).toBe(true);
    expect(result.rejectionReason).toBeUndefined();
  });

  it('RN2 — não sofre erro de precisão de ponto flutuante (0.29 não é .99)', async () => {
    const result = await gateway.process(0.29);

    expect(result.approved).toBe(true);
  });

  it('RN7 — sempre gera transactionId, aprovado ou rejeitado', async () => {
    const approved = await gateway.process(10);
    const rejected = await gateway.process(20000);

    expect(approved.transactionId).toMatch(/^txn_/);
    expect(rejected.transactionId).toMatch(/^txn_/);
  });

  it('exatamente 10000 é aprovado (limite é > 10000, não >=)', async () => {
    const result = await gateway.process(10000);

    expect(result.approved).toBe(true);
  });
});
