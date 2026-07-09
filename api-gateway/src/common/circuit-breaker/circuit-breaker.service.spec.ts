import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';

import { CircuitBreakerService } from './circuit-breaker.service';

describe('CircuitBreakerService', () => {
  let service: CircuitBreakerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CircuitBreakerService],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not count a client error (4xx) as a circuit failure and skips the fallback', async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new HttpException('Conflict', 409));
    const fallback = jest.fn();

    await expect(
      service.executeWithCircuitBreaker(
        operation,
        'client-error-key',
        { failureThreshold: 1, timeout: 1000, resetTimeout: 1000 },
        fallback,
      ),
    ).rejects.toMatchObject({ status: 409 });

    expect(fallback).not.toHaveBeenCalled();
    expect(service.getCircuitState('client-error-key')?.failureCount).toBe(0);
  });

  it('counts a non-client error as a circuit failure and uses the fallback', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('boom'));
    const fallback = jest.fn().mockResolvedValue('fallback-result');

    const result = await service.executeWithCircuitBreaker(
      operation,
      'server-error-key',
      { failureThreshold: 3, timeout: 1000, resetTimeout: 1000 },
      fallback,
    );

    expect(result).toBe('fallback-result');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(service.getCircuitState('server-error-key')?.failureCount).toBe(1);
  });

  it('opens the circuit after failureThreshold non-client errors', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('boom'));

    for (let i = 0; i < 2; i++) {
      await service.executeWithCircuitBreaker(
        operation,
        'open-circuit-key',
        { failureThreshold: 2, timeout: 1000, resetTimeout: 30000 },
        jest.fn().mockResolvedValue('fallback'),
      );
    }

    expect(service.getCircuitState('open-circuit-key')?.state).toBe('OPEN');
  });
});
