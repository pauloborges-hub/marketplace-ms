import { ExecutionContext } from '@nestjs/common';
import { ThrottlerException, ThrottlerRequest } from '@nestjs/throttler';

import { CustomThrottlerGuard } from './throttler.guard';

/**
 * O CustomThrottlerGuard estende o ThrottlerGuard do @nestjs/throttler, cujo
 * construtor pede options/storage/reflector. Em vez de subir um módulo de teste
 * inteiro, a instância é criada com `Object.create` e as colaborações que os
 * dois métodos sobrescritos usam são injetadas à mão — o que mantém o teste
 * focado no comportamento próprio do guard.
 */
type GuardInternals = {
  getTracker(req: Record<string, unknown>): Promise<string>;
  handleRequest(requestProps: ThrottlerRequest): Promise<boolean>;
  storageService: { increment: jest.Mock };
  reflector: { get: jest.Mock };
  headerPrefix: string;
  generateKey: jest.Mock;
  getRequestResponse: jest.Mock;
};

describe('CustomThrottlerGuard', () => {
  let guard: GuardInternals;
  let res: { setHeader: jest.Mock };

  const req = {
    ip: '10.0.0.7',
    headers: { 'user-agent': 'jest-agent' },
  };

  const buildContext = () =>
    ({ getHandler: () => () => undefined }) as unknown as ExecutionContext;

  const buildRequestProps = (limit = 5, ttl = 60000): ThrottlerRequest =>
    ({ context: buildContext(), limit, ttl }) as unknown as ThrottlerRequest;

  beforeEach(() => {
    res = { setHeader: jest.fn() };
    guard = Object.create(CustomThrottlerGuard.prototype) as GuardInternals;

    guard.storageService = { increment: jest.fn() };
    guard.reflector = { get: jest.fn().mockReturnValue(undefined) };
    guard.headerPrefix = 'X-RateLimit';
    guard.generateKey = jest.fn().mockReturnValue('generated-key');
    guard.getRequestResponse = jest.fn().mockReturnValue({ req, res });
  });

  describe('getTracker', () => {
    it('identifica o cliente por ip + user-agent', async () => {
      await expect(guard.getTracker(req)).resolves.toBe('10.0.0.7-jest-agent');
    });

    it('distingue dois user-agents vindos do mesmo ip', async () => {
      const other = { ip: '10.0.0.7', headers: { 'user-agent': 'curl/8' } };

      await expect(guard.getTracker(other)).resolves.not.toBe(
        await guard.getTracker(req),
      );
    });
  });

  describe('handleRequest', () => {
    it('libera a request e expõe os headers de rate limit quando está dentro do limite', async () => {
      guard.storageService.increment.mockResolvedValue(2);

      await expect(
        guard.handleRequest(buildRequestProps(5, 60000)),
      ).resolves.toBe(true);

      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 3);
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Reset', 60);
    });

    it('libera a request exatamente no limite (totalHits === limit)', async () => {
      guard.storageService.increment.mockResolvedValue(5);

      await expect(guard.handleRequest(buildRequestProps(5))).resolves.toBe(
        true,
      );
      expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', 0);
    });

    it('lança ThrottlerException e envia Retry-After ao estourar o limite', async () => {
      guard.storageService.increment.mockResolvedValue(6);

      await expect(
        guard.handleRequest(buildRequestProps(5, 60000)),
      ).rejects.toThrow(ThrottlerException);

      expect(res.setHeader).toHaveBeenCalledWith('Retry-After', 60);
      // Ao bloquear, os headers informativos não são enviados.
      expect(res.setHeader).not.toHaveBeenCalledWith('X-RateLimit-Limit', 5);
    });

    it('usa o nome do throttler declarado no @Throttle da rota', async () => {
      guard.reflector.get.mockReturnValue({ short: { limit: 3, ttl: 1000 } });
      guard.storageService.increment.mockResolvedValue(1);

      await guard.handleRequest(buildRequestProps(3, 1000));

      expect(guard.generateKey).toHaveBeenCalledWith(
        expect.anything(),
        '10.0.0.7-jest-agent',
        'short',
      );
      expect(guard.storageService.increment).toHaveBeenCalledWith(
        'generated-key',
        1000,
        3,
        1,
        'short',
      );
    });

    it('cai no throttler "default" quando a rota não declara @Throttle', async () => {
      guard.reflector.get.mockReturnValue(undefined);
      guard.storageService.increment.mockResolvedValue(1);

      await guard.handleRequest(buildRequestProps());

      expect(guard.generateKey).toHaveBeenCalledWith(
        expect.anything(),
        '10.0.0.7-jest-agent',
        'default',
      );
    });
  });
});
