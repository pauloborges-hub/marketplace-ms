import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PaymentQueueService } from './payment-queue/payment-queue.service';
import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [ConfigModule],
  providers: [RabbitmqService, PaymentQueueService],
})
export class EventsModule {}
