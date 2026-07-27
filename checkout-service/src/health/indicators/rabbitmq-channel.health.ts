import { Injectable } from '@nestjs/common';
import {
  HealthIndicatorResult,
  HealthIndicatorService,
} from '@nestjs/terminus';

import { RabbitmqService } from '../../events/rabbitmq/rabbitmq.service';

/**
 * Verifica se **este processo** tem um canal AMQP ativo.
 *
 * Complementa o indicador `rabbitmq` (MicroserviceHealthIndicator), que só
 * garante que o broker aceita conexões. Sem esta checagem o serviço pode
 * reportar `up` num cenário em que o broker está de pé mas o RabbitmqService
 * perdeu (ou nunca estabeleceu) a conexão — `connect()` engole a falha e
 * `publishMessage()` faz early-return silencioso, descartando os eventos
 * `payment.order`.
 *
 * Síncrono e barato de propósito: apenas lê um campo em memória. Sem I/O, sem
 * abrir conexão e sem publicar mensagem de teste.
 */
@Injectable()
export class RabbitmqChannelHealthIndicator {
  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly rabbitmqService: RabbitmqService,
  ) {}

  isHealthy(key: string): HealthIndicatorResult {
    const indicator = this.healthIndicatorService.check(key);

    // `getChannel()` é declarado como `amqp.Channel`, mas devolve `undefined`
    // quando a conexão inicial falhou. A assinatura mente, então a checagem
    // abaixo é necessária mesmo que o tipo sugira o contrário.
    const channel = this.rabbitmqService.getChannel() as
      | ReturnType<RabbitmqService['getChannel']>
      | undefined;

    if (!channel) {
      return indicator.down(
        'No active AMQP channel: messages are being discarded',
      );
    }

    return indicator.up();
  }
}
