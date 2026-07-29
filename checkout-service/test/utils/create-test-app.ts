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
 * Boots the real AppModule (real TypeORM + JWT guard) with the same global
 * ValidationPipe used in production. Pass `customize` to tweak the testing
 * module builder — e.g. to override the ProductsClientService with a mock.
 *
 * O banco é SQLite em memória (ver test/utils/test-database.config.ts) e o
 * RabbitMQ é substituído por dublês por padrão, então a suíte não fala com
 * nenhum serviço externo. `customize` roda depois dos overrides padrão e pode
 * sobrescrevê-los.
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
