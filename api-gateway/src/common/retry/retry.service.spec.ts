import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';

import { RetryService } from './retry.service';

describe('RetryService', () => {
  let service: RetryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryService],
    }).compile();

    service = module.get<RetryService>(RetryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not retry a client error (4xx HttpException) and fails on the first attempt', async () => {
    const operation = jest
      .fn()
      .mockRejectedValue(new HttpException('Conflict', 409));

    const result = await service.executeWithRetry(operation, {
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 1,
      backoffMultiplier: 1,
      jitter: false,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
  });

  it('retries a non-client error up to maxRetries', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('boom'));

    const result = await service.executeWithRetry(operation, {
      maxRetries: 2,
      baseDelay: 1,
      maxDelay: 1,
      backoffMultiplier: 1,
      jitter: false,
    });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('succeeds without retrying when the operation resolves', async () => {
    const operation = jest.fn().mockResolvedValue('ok');

    const result = await service.executeWithRetry(operation, {
      maxRetries: 3,
      baseDelay: 1,
      maxDelay: 1,
      backoffMultiplier: 1,
      jitter: false,
    });

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.data).toBe('ok');
  });
});
