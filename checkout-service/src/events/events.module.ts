import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [ConfigModule],
  providers: [RabbitmqService, PaymentQueueService],
  exports: [RabbitmqService, PaymentQueueService],
})
export class EventsModule {}
