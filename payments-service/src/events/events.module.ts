import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { DlqController } from './dlq/dlq.controller';
import { DlqService } from './dlq/dlq.service';
import { PaymentConsumerService } from './payment-consumer/payment-consumer.service';
import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [ConfigModule],
  controllers: [DlqController],
  providers: [
    RabbitmqService,
    PaymentQueueService,
    PaymentConsumerService,
    DlqService,
  ],
})
export class EventsModule {}
