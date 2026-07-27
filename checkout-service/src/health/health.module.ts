import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { EventsModule } from '../events/events.module';
import { HealthController } from './health.controller';
import { RabbitmqChannelHealthIndicator } from './indicators/rabbitmq-channel.health';

@Module({
  // EventsModule já exporta o RabbitmqService: importá-lo aqui reaproveita a
  // instância viva do serviço. Declarar RabbitmqService em `providers` abriria
  // uma segunda conexão AMQP, paralela à real.
  imports: [TerminusModule, EventsModule],
  controllers: [HealthController],
  providers: [RabbitmqChannelHealthIndicator],
})
export class HealthModule {}
