import { Injectable, Logger } from '@nestjs/common';
import { RabbitmqService } from '../rabbitmq/rabbitmq.service';
import { PaymentResultMessage } from '../payment-result.interface';

@Injectable()
export class PaymentQueueService {
  private readonly logger = new Logger(PaymentQueueService.name);

  private readonly ROUTING_KEY = 'payment.order';
  private readonly RESULT_ROUTING_KEY = 'payment.result';
  private readonly EXCHANGE = 'payments';
  private readonly QUEUE_NAME = 'payment_queue';

  constructor(private readonly rabbitMQService: RabbitmqService) {}

  async consumePaymentOrders(
    callback: (message: any) => Promise<void>,
  ): Promise<void> {
    this.logger.log('📡 Setting up payment orders consumer...');

    await this.rabbitMQService.subscribeToQueue(
      this.QUEUE_NAME,
      this.EXCHANGE,
      this.ROUTING_KEY,
      callback,
    );

    this.logger.log('✅ Payment orders consumer is ready');
  }

  /**
   * Publica o resultado do processamento de um pagamento de volta na exchange
   * `payments`, para que o checkout-service atualize o status do pedido.
   */
  async publishPaymentResult(result: PaymentResultMessage): Promise<void> {
    this.logger.log(
      `📤 Publishing payment result for orderId=${result.orderId} ` +
        `(status=${result.status})`,
    );

    await this.rabbitMQService.publishMessage(
      this.EXCHANGE,
      this.RESULT_ROUTING_KEY,
      {
        ...result,
        metadata: {
          service: 'payments-service',
          timestamp: new Date().toISOString(),
        },
      },
    );
  }
}
