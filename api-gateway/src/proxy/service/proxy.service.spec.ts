import { Test, TestingModule } from '@nestjs/testing';
import { HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AxiosError, AxiosHeaders } from 'axios';

import { CircuitBreakerService } from 'src/common/circuit-breaker/circuit-breaker.service';
import { CacheFallbackService } from 'src/common/fallback/cache.fallback';
import { DefaultFallbackService } from 'src/common/fallback/default.fallback';
import { RetryService } from 'src/common/retry/retry.service';
import { TimeoutService } from 'src/common/timeout/timeout.service';
import { ProxyService } from './proxy.service';

function axiosError(status: number, data: unknown): AxiosError {
  const error = new AxiosError('Request failed', String(status));
  error.response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  return error;
}

describe('ProxyService', () => {
  let service: ProxyService;
  let httpService: { request: jest.Mock };

  beforeEach(async () => {
    httpService = { request: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyService,
        { provide: HttpService, useValue: httpService },
        {
          provide: CircuitBreakerService,
          useValue: {
            executeWithCircuitBreaker: (operation: () => unknown) =>
              operation(),
          },
        },
        {
          provide: RetryService,
          useValue: {
            executeWithExponentialBackoff: (operation: () => unknown) =>
              operation(),
          },
        },
        {
          provide: TimeoutService,
          useValue: {
            executeWithCustomTimeout: (operation: () => unknown) =>
              operation(),
          },
        },
        CacheFallbackService,
        DefaultFallbackService,
      ],
    }).compile();

    service = module.get<ProxyService>(ProxyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns the response data on success', async () => {
    httpService.request.mockReturnValueOnce(of({ data: { id: '1' } }));

    const result = await service.proxyRequest(
      'users',
      'GET',
      '/users/1',
      undefined,
      {},
    );

    expect(result).toEqual({ id: '1' });
  });

  it('converts a downstream 4xx error into an HttpException with the same status and body', async () => {
    const body = { statusCode: 409, message: 'Email already registered' };
    httpService.request.mockReturnValueOnce(
      throwError(() => axiosError(409, body)),
    );

    await expect(
      service.proxyRequest('users', 'POST', '/auth/register', {}),
    ).rejects.toMatchObject({
      response: body,
      status: 409,
    });
  });

  it('does not convert a 5xx error, leaving it to retry/circuit-breaker handling', async () => {
    const error = axiosError(503, { message: 'Service unavailable' });
    httpService.request.mockReturnValueOnce(throwError(() => error));

    await expect(
      service.proxyRequest('users', 'GET', '/users/1', undefined, {}),
    ).rejects.not.toBeInstanceOf(HttpException);
  });

  it('does not convert a network error with no response, leaving it unchanged', async () => {
    const error = new AxiosError('Network Error');
    httpService.request.mockReturnValueOnce(throwError(() => error));

    await expect(
      service.proxyRequest('users', 'GET', '/users/1', undefined, {}),
    ).rejects.toBe(error);
  });
});
