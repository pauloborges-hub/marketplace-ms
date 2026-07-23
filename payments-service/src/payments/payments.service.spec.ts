import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentOrderMessage } from '../events/payment-queue.interface';
import { MetricsService } from '../metrics/metrics.service';
import {
  FakePaymentGatewayService,
  GatewayResult,
} from './fake-payment-gateway.service';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let repository: jest.Mocked<Pick<Repository<Payment>, 'findOne' | 'create' | 'save'>>;
  let gateway: { process: jest.Mock<Promise<GatewayResult>, [number]> };
  let metrics: { recordPaymentProcessed: jest.Mock };

  const buildMessage = (
    overrides: Partial<PaymentOrderMessage> = {},
  ): PaymentOrderMessage => ({
    orderId: 'order-1',
    userId: 'user-1',
    amount: 150.5,
    paymentMethod: 'pix',
    items: [{ productId: 'prod-1', quantity: 1, price: 150.5 }],
    ...overrides,
  });

  beforeEach(async () => {
    // create devolve um objeto Payment com os campos nuláveis já inicializados.
    const createMock = jest.fn(
      (dto: Partial<Payment>): Payment =>
        ({
          transactionId: null,
          rejectionReason: null,
          processedAt: null,
          ...dto,
        }) as Payment,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        {
          provide: getRepositoryToken(Payment),
          useValue: {
            findOne: jest.fn(),
            create: createMock,
            save: jest.fn((entity: Payment) => Promise.resolve(entity)),
          },
        },
        {
          provide: FakePaymentGatewayService,
          useValue: { process: jest.fn() },
        },
        {
          provide: MetricsService,
          useValue: { recordPaymentProcessed: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
    repository = module.get(getRepositoryToken(Payment));
    gateway = module.get(FakePaymentGatewayService);
    metrics = module.get(MetricsService);
  });

  describe('processPayment', () => {
    it('CA1 — cria Payment pending e o persiste ANTES de acionar o gateway', async () => {
      repository.findOne.mockResolvedValue(null);
      gateway.process.mockImplementation(async () => {
        // No momento em que o gateway roda, o registro pending já foi salvo.
        expect(repository.save).toHaveBeenCalledTimes(1);
        const firstSaved = repository.save.mock.calls[0][0] as Payment;
        expect(firstSaved.status).toBe(PaymentStatus.PENDING);
        return { approved: true, transactionId: 'txn_1' };
      });

      const message = buildMessage();
      await service.processPayment(message);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: message.orderId,
          userId: message.userId,
          amount: message.amount,
          paymentMethod: message.paymentMethod,
          status: PaymentStatus.PENDING,
        }),
      );
      expect(gateway.process).toHaveBeenCalledWith(message.amount);
    });

    it('CA2 — atualiza o Payment com resultado aprovado (status, transactionId, processedAt; reason nulo)', async () => {
      repository.findOne.mockResolvedValue(null);
      gateway.process.mockResolvedValue({
        approved: true,
        transactionId: 'txn_approved',
      });

      await service.processPayment(buildMessage());

      const finalSaved = repository.save.mock.calls[1][0] as Payment;
      expect(finalSaved.status).toBe(PaymentStatus.APPROVED);
      expect(finalSaved.transactionId).toBe('txn_approved');
      expect(finalSaved.processedAt).toBeInstanceOf(Date);
      expect(finalSaved.rejectionReason).toBeNull();
    });

    it('CA2 — atualiza o Payment com resultado rejeitado (rejectionReason preenchido)', async () => {
      repository.findOne.mockResolvedValue(null);
      gateway.process.mockResolvedValue({
        approved: false,
        transactionId: 'txn_rejected',
        rejectionReason: 'Limite excedido',
      });

      await service.processPayment(buildMessage({ amount: 20000 }));

      const finalSaved = repository.save.mock.calls[1][0] as Payment;
      expect(finalSaved.status).toBe(PaymentStatus.REJECTED);
      expect(finalSaved.rejectionReason).toBe('Limite excedido');
      expect(finalSaved.processedAt).toBeInstanceOf(Date);
    });

    it('CA7/RN5 — Payment em status final não recria registro nem aciona o gateway', async () => {
      repository.findOne.mockResolvedValue({
        orderId: 'order-1',
        status: PaymentStatus.APPROVED,
      } as Payment);

      await service.processPayment(buildMessage());

      expect(gateway.process).not.toHaveBeenCalled();
      expect(repository.create).not.toHaveBeenCalled();
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('RN5 — Payment pending existente é retomado (não recria), aciona o gateway e atualiza o mesmo registro', async () => {
      const pending = {
        orderId: 'order-1',
        status: PaymentStatus.PENDING,
        transactionId: null,
        rejectionReason: null,
        processedAt: null,
      } as Payment;
      repository.findOne.mockResolvedValue(pending);
      gateway.process.mockResolvedValue({
        approved: true,
        transactionId: 'txn_resumed',
      });

      await service.processPayment(buildMessage());

      expect(repository.create).not.toHaveBeenCalled();
      expect(gateway.process).toHaveBeenCalledTimes(1);
      expect(pending.status).toBe(PaymentStatus.APPROVED);
      expect(pending.transactionId).toBe('txn_resumed');
    });

    it('CA8/RN6 — falha técnica ao persistir propaga exceção', async () => {
      repository.findOne.mockResolvedValue(null);
      repository.save.mockRejectedValueOnce(new Error('DB down'));

      await expect(service.processPayment(buildMessage())).rejects.toThrow(
        'DB down',
      );
      expect(gateway.process).not.toHaveBeenCalled();
    });

    it('CA-2 — pagamento aprovado registra a métrica de negócio como APPROVED', async () => {
      repository.findOne.mockResolvedValue(null);
      gateway.process.mockResolvedValue({
        approved: true,
        transactionId: 'txn_approved',
      });

      await service.processPayment(buildMessage());

      expect(metrics.recordPaymentProcessed).toHaveBeenCalledTimes(1);
      expect(metrics.recordPaymentProcessed).toHaveBeenCalledWith(
        PaymentStatus.APPROVED,
        null,
      );
    });

    it('CA-3 — pagamento rejeitado registra a métrica de negócio com o reason do gateway', async () => {
      repository.findOne.mockResolvedValue(null);
      gateway.process.mockResolvedValue({
        approved: false,
        transactionId: 'txn_rejected',
        rejectionReason: 'Limite excedido',
      });

      await service.processPayment(buildMessage({ amount: 20000 }));

      expect(metrics.recordPaymentProcessed).toHaveBeenCalledTimes(1);
      expect(metrics.recordPaymentProcessed).toHaveBeenCalledWith(
        PaymentStatus.REJECTED,
        'Limite excedido',
      );
    });

    it('CA-4 — redelivery de pedido já finalizado NÃO registra a métrica de negócio', async () => {
      repository.findOne.mockResolvedValue({
        orderId: 'order-1',
        status: PaymentStatus.APPROVED,
      } as Payment);

      await service.processPayment(buildMessage());

      expect(metrics.recordPaymentProcessed).not.toHaveBeenCalled();
    });
  });

  describe('findByOrderId', () => {
    it('retorna o Payment quando existe', async () => {
      const payment = { orderId: 'order-1' } as Payment;
      repository.findOne.mockResolvedValue(payment);

      await expect(service.findByOrderId('order-1')).resolves.toBe(payment);
    });

    it('CA10 — lança NotFoundException quando não existe', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findByOrderId('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
