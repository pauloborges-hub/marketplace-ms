import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Injectable } from '@nestjs/common';

import { RabbitmqService } from '../../events/rabbitmq/rabbitmq.service';

/**
 * Verifica se ESTE processo mantém um canal AMQP ativo.
 *
 * Complementa o indicador `rabbitmq` (MicroserviceHealthIndicator), que só
 * atesta que o broker está no ar: o broker pode estar de pé enquanto o
 * RabbitmqService local nunca conectou — e nesse caso os pagamentos não estão
 * sendo consumidos.
 *
 * Leitura de campo em memória, sem I/O.
 */
@Injectable()
export class RabbitmqChannelHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  isHealthy<Key extends string>(key: Key): HealthIndicatorResult<Key> {
    const indicator = this.healthIndicatorService.check(key);

    if (!this.rabbitmqService.getChannel()) {
      return indicator.down(
        'RabbitMQ channel unavailable — payments are not being consumed',
      );
    }

    return indicator.up();
  }
}
