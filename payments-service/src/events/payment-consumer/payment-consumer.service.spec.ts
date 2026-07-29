import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { PaymentOrderMessage } from '../payment-queue.interface';
import { PaymentQueueService } from '../payment-queue/payment-queue.service';
import { PaymentConsumerService } from './payment-consumer.service';
import { PaymentsService } from '../../payments/payments.service';
import { Payment, PaymentStatus } from '../../payments/entities/payment.entity';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';

describe('PaymentConsumerService', () => {
  let service: PaymentConsumerService;

  const paymentQueue = {
    consumePaymentOrders: jest.fn(),
    publishPaymentResult: jest.fn(),
  };
  const rabbitmq = { waitForConnection: jest.fn() };
  const payments = { processPayment: jest.fn() };

  const buildMessage = (
    overrides: Partial<PaymentOrderMessage> = {},
  ): PaymentOrderMessage => ({
    orderId: 'order-1',
    userId: 'user-1',
    amount: 150.5,
    paymentMethod: 'pix',
    items: [{ productId: 'product-1', quantity: 2, price: 75.25 }],
    ...overrides,
  });

  const buildPayment = (overrides: Partial<Payment> = {}): Payment =>
    ({
      orderId: 'order-1',
      userId: 'user-1',
      amount: 150.5,
      paymentMethod: 'pix',
      status: PaymentStatus.APPROVED,
      transactionId: 'txn_1',
      rejectionReason: null,
      processedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    }) as Payment;

  /**
   * `processPaymentOrder` é privado e só chega ao consumer pelo callback que ele
   * registra na fila. Rodar o onModuleInit e capturar esse callback exercita o
   * caminho real (registro + processamento) em vez de furar o encapsulamento.
   */
  const startAndCaptureHandler = async (): Promise<
    (message: PaymentOrderMessage) => Promise<void>
  > => {
    await service.onModuleInit();

    expect(paymentQueue.consumePaymentOrders).toHaveBeenCalledTimes(1);
    return paymentQueue.consumePaymentOrders.mock.calls[0][0] as (
      message: PaymentOrderMessage,
    ) => Promise<void>;
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    rabbitmq.waitForConnection.mockResolvedValue(true);
    payments.processPayment.mockResolvedValue(buildPayment());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentConsumerService,
        { provide: PaymentQueueService, useValue: paymentQueue },
        { provide: RabbitmqService, useValue: rabbitmq },
        { provide: PaymentsService, useValue: payments },
      ],
    }).compile();

    service = module.get<PaymentConsumerService>(PaymentConsumerService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('startConsuming', () => {
    it('registra o consumidor da fila quando o RabbitMQ está conectado', async () => {
      await service.onModuleInit();

      expect(rabbitmq.waitForConnection).toHaveBeenCalled();
      expect(paymentQueue.consumePaymentOrders).toHaveBeenCalledTimes(1);
    });

    it('não registra o consumidor quando a conexão nunca é estabelecida', async () => {
      rabbitmq.waitForConnection.mockResolvedValue(false);

      await service.onModuleInit();

      expect(paymentQueue.consumePaymentOrders).not.toHaveBeenCalled();
    });

    // O boot do serviço não pode quebrar por causa do broker: o Nest abortaria
    // a subida da aplicação inteira.
    it('não propaga erro quando o registro do consumidor falha', async () => {
      paymentQueue.consumePaymentOrders.mockRejectedValue(
        new Error('broker down'),
      );

      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('processamento de mensagens', () => {
    it('processa o pagamento e publica o resultado de volta na fila', async () => {
      const handler = await startAndCaptureHandler();
      const message = buildMessage();

      await handler(message);

      expect(payments.processPayment).toHaveBeenCalledWith(message);
      expect(paymentQueue.publishPaymentResult).toHaveBeenCalledWith({
        orderId: 'order-1',
        userId: 'user-1',
        status: PaymentStatus.APPROVED,
        amount: 150.5,
        paymentMethod: 'pix',
        transactionId: 'txn_1',
        rejectionReason: null,
        processedAt: '2026-01-01T00:00:00.000Z',
      });
    });

    it('publica o resultado também quando o pagamento é rejeitado', async () => {
      payments.processPayment.mockResolvedValue(
        buildPayment({
          status: PaymentStatus.REJECTED,
          transactionId: null,
          rejectionReason: 'amount exceeds limit',
        }),
      );

      const handler = await startAndCaptureHandler();
      await handler(buildMessage());

      expect(paymentQueue.publishPaymentResult).toHaveBeenCalledWith(
        expect.objectContaining({
          status: PaymentStatus.REJECTED,
          rejectionReason: 'amount exceeds limit',
          transactionId: null,
        }),
      );
    });

    it('usa o instante atual como processedAt quando o pagamento não traz um', async () => {
      payments.processPayment.mockResolvedValue(
        buildPayment({ processedAt: null }),
      );

      const handler = await startAndCaptureHandler();
      await handler(buildMessage());

      const published = paymentQueue.publishPaymentResult.mock.calls[0][0] as {
        processedAt: string;
      };
      expect(Number.isNaN(Date.parse(published.processedAt))).toBe(false);
    });

    it.each([
      ['orderId ausente', { orderId: '' }],
      ['userId ausente', { userId: '' }],
      ['amount zerado', { amount: 0 }],
      ['amount negativo', { amount: -10 }],
      ['paymentMethod ausente', { paymentMethod: '' }],
      ['sem itens', { items: [] }],
    ])(
      'descarta a mensagem inválida (%s) sem chamar o PaymentsService',
      async (_label, override) => {
        const handler = await startAndCaptureHandler();

        await handler(buildMessage(override as Partial<PaymentOrderMessage>));

        expect(payments.processPayment).not.toHaveBeenCalled();
        expect(paymentQueue.publishPaymentResult).not.toHaveBeenCalled();
      },
    );

    // Relançar é o que faz o RabbitMQ dar NACK e acionar retry/DLQ. Engolir o
    // erro aqui perderia o pagamento silenciosamente.
    it('propaga o erro quando o processamento falha, para que a mensagem sofra NACK', async () => {
      payments.processPayment.mockRejectedValue(new Error('db offline'));

      const handler = await startAndCaptureHandler();

      await expect(handler(buildMessage())).rejects.toThrow('db offline');
    });
  });

  describe('métricas', () => {
    it('começa zerada', () => {
      expect(service.getMetrics()).toMatchObject({
        totalProcessed: 0,
        totalSuccess: 0,
        totalFailed: 0,
        totalRetries: 0,
        lastProcessedAt: null,
      });
    });

    it('contabiliza os pagamentos processados com sucesso', async () => {
      const handler = await startAndCaptureHandler();

      await handler(buildMessage());
      await handler(buildMessage({ orderId: 'order-2' }));

      expect(service.getMetrics()).toMatchObject({
        totalProcessed: 2,
        totalSuccess: 2,
        totalFailed: 0,
      });
      expect(service.getMetrics().lastProcessedAt).toBeInstanceOf(Date);
    });

    it('não contabiliza mensagens que falharam no processamento', async () => {
      payments.processPayment.mockRejectedValue(new Error('db offline'));
      const handler = await startAndCaptureHandler();

      await expect(handler(buildMessage())).rejects.toThrow();

      expect(service.getMetrics()).toMatchObject({
        totalProcessed: 0,
        totalSuccess: 0,
      });
    });

    it('incrementa o contador de retries', () => {
      service.incrementRetryCount();
      service.incrementRetryCount();

      expect(service.getMetrics().totalRetries).toBe(2);
    });

    it('devolve uma cópia das métricas, protegendo o estado interno', () => {
      const snapshot = service.getMetrics();
      snapshot.totalProcessed = 999;

      expect(service.getMetrics().totalProcessed).toBe(0);
    });

    it('zera as métricas no reset', async () => {
      const handler = await startAndCaptureHandler();
      await handler(buildMessage());
      service.incrementRetryCount();

      service.resetMetrics();

      expect(service.getMetrics()).toMatchObject({
        totalProcessed: 0,
        totalSuccess: 0,
        totalRetries: 0,
        lastProcessedAt: null,
      });
    });

    it('calcula o tempo médio de processamento', async () => {
      const handler = await startAndCaptureHandler();

      await handler(buildMessage());

      expect(service.getMetrics().averageProcessingTime).toBeGreaterThanOrEqual(
        0,
      );
    });
  });
});
