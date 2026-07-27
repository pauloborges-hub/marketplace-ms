import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RmqOptions, Transport } from '@nestjs/microservices';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  MicroserviceHealthIndicator,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { Public } from '../auth/decorators/public.decorator';
import { RabbitmqChannelHealthIndicator } from './indicators/rabbitmq-channel.health';

/** Mesmo default do RabbitmqService — os dois precisam apontar para o mesmo broker. */
const DEFAULT_RABBITMQ_URL = 'amqp://admin:admin@localhost:5672';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly microservice: MicroserviceHealthIndicator,
    private readonly rabbitChannel: RabbitmqChannelHealthIndicator,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check do checkout-service' })
  @ApiResponse({ status: 200, description: 'Todas as dependências operantes' })
  @ApiResponse({ status: 503, description: 'Alguma dependência indisponível' })
  check() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 1500 }),
      () =>
        this.microservice.pingCheck<RmqOptions>('rabbitmq', {
          transport: Transport.RMQ,
          options: {
            urls: [
              this.config.get<string>('RABBITMQ_URL', DEFAULT_RABBITMQ_URL),
            ],
            // Sem isto o ClientRMQ faz `assertQueue('')` a cada checagem e o
            // broker acumula filas duráveis `amq.gen-*` indefinidamente
            // (medido: +2 filas por chamada). O ping só precisa do handshake.
            noAssert: true,
          },
          timeout: 3000,
        }),
      () => this.rabbitChannel.isHealthy('rabbitmq-channel'),
    ]);
  }
}
