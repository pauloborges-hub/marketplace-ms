import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';

import { RabbitmqService } from './rabbitmq/rabbitmq.service';

@Module({
  imports: [ConfigModule],
  providers: [RabbitmqService],
  exports: [RabbitmqService],
})
export class EventsModule {}
