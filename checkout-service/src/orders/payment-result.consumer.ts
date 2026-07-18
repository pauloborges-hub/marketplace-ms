import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PaymentResultMessage } from '../events/payment-result.interface';
import { RabbitmqService } from '../events/rabbitmq/rabbitmq.service';
import { OrdersService } from './orders.service';

/**
 * Consome os resultados de pagamento publicados pelo payments-service
 * (exchange `payments`, routing key `payment.result`) e atualiza o status
 * do pedido correspondente.
 */
@Injectable()
export class PaymentResultConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentResultConsumer.name);

  private readonly EXCHANGE = 'payments';
  private readonly ROUTING_KEY = 'payment.result';
  private readonly QUEUE_NAME = 'checkout_payment_result_queue';

  constructor(
    private readonly rabbitMQService: RabbitmqService,
    private readonly ordersService: OrdersService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 Starting Payment Result Consumer');

    const isConnected = await this.rabbitMQService.waitForConnection();
    if (!isConnected) {
      this.logger.error(
        '❌ Could not connect to RabbitMQ, payment results will not be consumed',
      );
      return;
    }

    await this.rabbitMQService.subscribeToQueue(
      this.QUEUE_NAME,
      this.EXCHANGE,
      this.ROUTING_KEY,
      (message) => this.handlePaymentResult(message as PaymentResultMessage),
    );

    this.logger.log('✅ Payment Result Consumer is ready');
  }

  private async handlePaymentResult(
    message: PaymentResultMessage,
  ): Promise<void> {
    if (!message?.orderId || !message?.status) {
      this.logger.error(
        `❌ Invalid payment result message: ${JSON.stringify(message)}`,
      );
      return;
    }

    this.logger.log(
      `📨 Payment result for order ${message.orderId}: status=${message.status}`,
    );

    await this.ordersService.applyPaymentResult(message.orderId, message.status);
  }
}
