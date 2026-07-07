import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../users/entities/user.entity';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let context: ExecutionContext;
  let superCanActivate: jest.SpyInstance;

  const handler = () => undefined;
  class FakeController {}

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new JwtAuthGuard(reflector as unknown as Reflector);

    context = {
      getHandler: () => handler,
      getClass: () => FakeController,
    } as unknown as ExecutionContext;

    superCanActivate = jest
      .spyOn(Object.getPrototypeOf(JwtAuthGuard.prototype), 'canActivate')
      .mockReturnValue(true);
  });

  afterEach(() => {
    superCanActivate.mockRestore();
  });

  describe('canActivate', () => {
    it('returns true immediately, without invoking passport authentication, when the route is marked with @Public()', () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).not.toHaveBeenCalled();
    });

    it('delegates to the passport JWT authentication flow when the route is not marked with @Public()', () => {
      reflector.getAllAndOverride.mockReturnValue(false);

      const result = guard.canActivate(context);

      expect(superCanActivate).toHaveBeenCalledWith(context);
      expect(result).toBe(true);
    });

    it('delegates to the passport JWT authentication flow when no @Public() metadata is present at all', () => {
      reflector.getAllAndOverride.mockReturnValue(undefined);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(superCanActivate).toHaveBeenCalledWith(context);
    });

    it('reads the isPublic metadata from both the handler and the class', () => {
      reflector.getAllAndOverride.mockReturnValue(true);

      const result = guard.canActivate(context);

      expect(result).toBe(true);
      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(IS_PUBLIC_KEY, [
        handler,
        FakeController,
      ]);
    });
  });

  describe('handleRequest', () => {
    const user = { id: 'uuid-1', email: 'foo@bar.com', role: UserRole.BUYER };

    it('returns the authenticated user object unchanged when no error occurred and a user was resolved', () => {
      expect(guard.handleRequest(null, user)).toBe(user);
    });

    it('rethrows the original error when passport-jwt reports one (e.g. expired or invalid signature)', () => {
      const error = new UnauthorizedException('jwt expired');

      expect(() => guard.handleRequest(error, false)).toThrow(error);
    });

    it('throws UnauthorizedException when there is no error but no user was resolved (e.g. missing or malformed token)', () => {
      expect(() => guard.handleRequest(null, false)).toThrow(
        UnauthorizedException,
      );
    });
  });
});
