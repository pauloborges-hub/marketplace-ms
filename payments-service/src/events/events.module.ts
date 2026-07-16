import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { DlqController } from './dlq/dlq.controller';
import { DlqService } from './dlq/dlq.service';
import { MetricsController } from './metrics/metrics.controller';
import { PaymentConsumerService } from './payment-consumer/payment-consumer.service';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { PaymentsModule } from '../payments/payments.module';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [ConfigModule, PaymentsModule],
  controllers: [DlqController, MetricsController],
  providers: [
    RabbitmqService,
    PaymentQueueService,
    PaymentConsumerService,
    DlqService,
  ],
})
export class EventsModule {}
