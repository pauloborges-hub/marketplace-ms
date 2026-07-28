import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MicroserviceHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { RabbitmqService } from '../../src/events/rabbitmq/rabbitmq.service';
import {
  createFakeMicroserviceHealthIndicator,
  createFakeRabbitmqService,
} from './fake-rabbitmq';

/**
 * Sobe o AppModule real com o mesmo ValidationPipe global do main.ts.
 *
 * O banco é SQLite em memória (ver test/utils/test-database.config.ts) e o
 * RabbitmqService é substituído por um dublê, o que neutraliza toda a cadeia
 * AMQP de uma vez: o PaymentQueueService e o DlqService delegam a ele, e o
 * PaymentConsumerService deixa de gastar 5s em `waitForConnection()` a cada
 * boot. `customize` roda depois dos overrides padrão e pode sobrescrevê-los.
 */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RabbitmqService)
    .useValue(createFakeRabbitmqService())
    .overrideProvider(MicroserviceHealthIndicator)
    .useValue(createFakeMicroserviceHealthIndicator());

  if (customize) {
    builder = customize(builder);
  }

  const moduleFixture = await builder.compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.init();

  return app;
}
