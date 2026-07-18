import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaymentOrderMessage } from '../events/payment-queue.interface';
import {
  FakePaymentGatewayService,
  GatewayResult,
} from './fake-payment-gateway.service';
import { Payment, PaymentStatus } from './entities/payment.entity';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectRepository(Payment)
    private readonly paymentRepository: Repository<Payment>,
    private readonly gateway: FakePaymentGatewayService,
  ) {}

  /**
   * Processa o pagamento de um pedido recebido da fila.
   *
   * Idempotente (RN5): um mesmo orderId nunca gera mais de um Payment.
   * Rejeições do gateway (RN1/RN2) são resultado de negócio e NÃO propagam
   * exceção — apenas falhas técnicas (ex.: persistência) propagam, para que
   * o consumer faça NACK e acione o retry/DLQ (RN6).
   */
  async processPayment(message: PaymentOrderMessage): Promise<Payment> {
    const existing: Payment | null = await this.paymentRepository.findOne({
      where: { orderId: message.orderId },
    });

    // RN5 — já processado (status final): trata como concluído, sem chamar
    // o gateway novamente nem criar um novo registro. Retorna o registro
    // existente para que o resultado possa ser re-publicado (idempotente).
    if (existing && existing.status !== PaymentStatus.PENDING) {
      this.logger.log(
        `⏭️  Payment for order ${message.orderId} already processed ` +
          `(status=${existing.status}), skipping`,
      );

      return existing;
    }

    // RN5 — retoma um Payment pending existente ou cria um novo.
    const payment: Payment =
      existing ??
      this.paymentRepository.create({
        orderId: message.orderId,
        userId: message.userId,
        amount: message.amount,
        paymentMethod: message.paymentMethod,
        status: PaymentStatus.PENDING,
      });

    // Persiste o registro pending antes de acionar o gateway (CA1).
    await this.paymentRepository.save(payment);

    const result: GatewayResult = await this.gateway.process(message.amount);

    payment.status = result.approved
      ? PaymentStatus.APPROVED
      : PaymentStatus.REJECTED;
    payment.transactionId = result.transactionId;
    payment.rejectionReason = result.approved
      ? null
      : (result.rejectionReason ?? null);
    payment.processedAt = new Date();

    await this.paymentRepository.save(payment);

    this.logger.log(
      `💳 Payment for order ${message.orderId} processed: ` +
        `status=${payment.status}, transactionId=${payment.transactionId}`,
    );

    return payment;
  }

  async findByOrderId(orderId: string): Promise<Payment> {
    const payment: Payment | null = await this.paymentRepository.findOne({
      where: { orderId },
    });

    if (!payment) {
      throw new NotFoundException(
        `Payment for order ${orderId} not found`,
      );
    }

    return payment;
  }
}
