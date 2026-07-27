import { ConfigModule } from '@nestjs/config';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { EventsModule } from '../events/events.module';
import { HealthController } from './health.controller';
import { RabbitmqChannelHealthIndicator } from './indicators/rabbitmq-channel.health';

/**
 * Importado pelo AppModule — nunca pelo PaymentsModule, o que fecharia o ciclo
 * PaymentsModule → HealthModule → EventsModule → PaymentsModule.
 *
 * O ConfigModule é importado explicitamente porque este serviço não registra
 * ConfigModule.forRoot({ isGlobal: true }).
 */
@Module({
  imports: [TerminusModule, ConfigModule, EventsModule],
  controllers: [HealthController],
  providers: [RabbitmqChannelHealthIndicator],
})
export class HealthModule {}
