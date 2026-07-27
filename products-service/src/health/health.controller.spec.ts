import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let indicators: HealthIndicatorFunction[];

  const pingCheck = jest.fn();
  const check = jest.fn((given: HealthIndicatorFunction[]) => {
    indicators = given;

    return {} as HealthCheckResult;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: { check } },
        { provide: TypeOrmHealthIndicator, useValue: { pingCheck } },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('delega ao HealthCheckService com um único indicador', async () => {
    await controller.check();

    expect(check).toHaveBeenCalledTimes(1);
    expect(indicators).toHaveLength(1);
  });

  it('verifica o banco com a chave "database" e timeout de 1500ms', async () => {
    await controller.check();
    await indicators[0]();

    expect(pingCheck).toHaveBeenCalledWith('database', { timeout: 1500 });
  });
});
