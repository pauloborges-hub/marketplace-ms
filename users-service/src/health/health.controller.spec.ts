import { Test, TestingModule } from '@nestjs/testing';
import {
  HealthCheckResult,
  HealthCheckService,
  HealthIndicatorFunction,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

import { IS_PUBLIC_KEY } from '../auth/decorators/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let health: {
    check: jest.Mock<Promise<HealthCheckResult>, [HealthIndicatorFunction[]]>;
  };
  let db: { pingCheck: jest.Mock };

  const upResult = {
    status: 'ok',
    info: { database: { status: 'up' } },
    error: {},
    details: { database: { status: 'up' } },
  } as HealthCheckResult;

  beforeEach(async () => {
    health = {
      check: jest
        .fn<Promise<HealthCheckResult>, [HealthIndicatorFunction[]]>()
        .mockResolvedValue(upResult),
    };
    db = {
      pingCheck: jest.fn().mockResolvedValue({ database: { status: 'up' } }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: TypeOrmHealthIndicator, useValue: db },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('delegates to HealthCheckService.check with a single indicator', async () => {
    await expect(controller.check()).resolves.toBe(upResult);

    expect(health.check).toHaveBeenCalledTimes(1);
    expect(health.check.mock.calls[0][0]).toHaveLength(1);
  });

  it('pings the database with the key "database" and a 1500ms timeout', async () => {
    await controller.check();

    const [indicator] = health.check.mock.calls[0][0];
    await indicator();

    expect(db.pingCheck).toHaveBeenCalledWith('database', { timeout: 1500 });
  });

  it('is marked with @Public() so the global JwtAuthGuard does not require a token', () => {
    // Lemos a metadata gravada pelo @SetMetadata no próprio handler; a
    // referência ao método não é uma chamada, então o `this` não importa aqui.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const handler = HealthController.prototype.check;

    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
  });
});
