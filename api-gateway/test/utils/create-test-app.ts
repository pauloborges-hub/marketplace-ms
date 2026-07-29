import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpHealthIndicator } from '@nestjs/terminus';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { HealthCheckService } from '../../src/common/health/health-check.service';
import {
  createFakeHealthCheckService,
  createFakeHttpHealthIndicator,
} from './fake-downstream';

/**
 * Sobe o AppModule real do gateway.
 *
 * O gateway não tem banco, mas o /health e o /health/services falam com os 4
 * serviços downstream por HTTP. Os dois indicadores são substituídos por dublês
 * para que a suíte não dependa de nenhum serviço no ar — o teste cross-service
 * de verdade é o marketplace-flow.e2e-spec, que roda fora do `npm run test:e2e`.
 *
 * `customize` roda depois dos overrides padrão e pode sobrescrevê-los.
 */
export async function createTestApp(
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HttpHealthIndicator)
    .useValue(createFakeHttpHealthIndicator())
    .overrideProvider(HealthCheckService)
    .useValue(createFakeHealthCheckService());

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
