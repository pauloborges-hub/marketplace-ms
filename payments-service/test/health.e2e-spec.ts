import {
  HealthCheckResult,
  MicroserviceHealthIndicator,
} from '@nestjs/terminus';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';

import { databaseConfig } from '../src/config/database.config';
import { HealthModule } from '../src/health/health.module';
import { MetricsModule } from '../src/metrics/metrics.module';
import { PaymentConsumerService } from '../src/events/payment-consumer/payment-consumer.service';
import { RabbitmqService } from '../src/events/rabbitmq/rabbitmq.service';

/**
 * Limitação conhecida: os dois indicadores de RabbitMQ são stubados aqui — o
 * MicroserviceHealthIndicator (que abriria uma conexão real ao broker) e o
 * RabbitmqService (cujo canal o indicador customizado inspeciona). Assim o
 * teste continua exercitando o Postgres de verdade sem exigir broker no
 * ambiente de teste.
 *
 * O comportamento com o broker fora (503 em `rabbitmq` e `rabbitmq-channel`) é
 * coberto pela validação manual da spec 03 (CA6/CA7).
 */
describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  const rabbitmq = {
    onModuleInit: jest.fn(),
    onModuleDestroy: jest.fn(),
    getChannel: jest.fn(() => ({})),
  };

  const paymentConsumer = {
    onModuleInit: jest.fn(),
  };

  const microservice = {
    pingCheck: jest.fn((key: string) => ({ [key]: { status: 'up' } })),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(databaseConfig),
        MetricsModule,
        HealthModule,
      ],
    })
      .overrideProvider(RabbitmqService)
      .useValue(rabbitmq)
      .overrideProvider(PaymentConsumerService)
      .useValue(paymentConsumer)
      .overrideProvider(MicroserviceHealthIndicator)
      .useValue(microservice)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const getHealth = async (expectedStatus: number) => {
    const res = await request(app.getHttpServer())
      .get('/health')
      .expect(expectedStatus);

    return res.body as HealthCheckResult;
  };

  it('CA11 — GET /health retorna 200 com banco operante', async () => {
    const body = await getHealth(200);

    expect(body.status).toBe('ok');
    expect(body.details.database.status).toBe('up');
  });

  it('CA4 — GET /health reporta os indicadores de RabbitMQ', async () => {
    const body = await getHealth(200);

    expect(body.details.rabbitmq.status).toBe('up');
    expect(body.details['rabbitmq-channel'].status).toBe('up');
  });

  it('CA6 — GET /health retorna 503 quando o canal AMQP está ausente', async () => {
    rabbitmq.getChannel.mockReturnValueOnce(undefined as never);

    const body = await getHealth(503);

    expect(body.status).toBe('error');
    expect(body.error?.['rabbitmq-channel'].status).toBe('down');
  });
});
