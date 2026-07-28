import { HealthIndicatorResult } from '@nestjs/terminus';

/**
 * Dublê do RabbitmqService para os testes e2e.
 *
 * Sem ele o AppModule real abriria uma conexão AMQP de verdade no
 * `onModuleInit`, e o PaymentResultConsumer ainda gastaria 5s em
 * `waitForConnection()` (10 tentativas × 500ms) antes de desistir — em *cada*
 * boot de aplicação da suíte.
 *
 * `getChannel()` devolve um objeto truthy para que o indicador
 * `rabbitmq-channel` reporte `up`, que é o estado saudável esperado.
 */
export function createFakeRabbitmqService() {
  return {
    getChannel: jest.fn().mockReturnValue({ fake: true }),
    getConnection: jest.fn().mockReturnValue({ fake: true }),
    waitForConnection: jest.fn().mockResolvedValue(true),
    publishMessage: jest.fn().mockResolvedValue(undefined),
    subscribeToQueue: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Dublê do MicroserviceHealthIndicator do Terminus.
 *
 * O indicador real abre um ClientRMQ contra o broker configurado; num ambiente
 * sem RabbitMQ isso deixaria o /health não-determinístico (200 ou 503 conforme
 * a máquina). Com o dublê o health check fica offline e determinístico.
 */
export function createFakeMicroserviceHealthIndicator() {
  return {
    pingCheck: jest
      .fn()
      .mockImplementation((key: string): Promise<HealthIndicatorResult> =>
        Promise.resolve({ [key]: { status: 'up' } }),
      ),
  };
}
