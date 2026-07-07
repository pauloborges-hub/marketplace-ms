import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../../users/entities/user.entity';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let configService: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    configService = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    };

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('reads the JWT secret from JWT_SECRET via ConfigService when constructed', () => {
    expect(configService.getOrThrow).toHaveBeenCalledWith('JWT_SECRET');
  });

  it('returns an object containing exactly id, email and role, derived from sub, email and role in the JWT payload', () => {
    const result = strategy.validate({
      sub: 'uuid-1',
      email: 'foo@bar.com',
      role: UserRole.BUYER,
      iat: 1000,
      exp: 2000,
    });

    expect(result).toEqual({
      id: 'uuid-1',
      email: 'foo@bar.com',
      role: UserRole.BUYER,
    });
  });

  it('does not leak JWT-specific fields such as sub, iat or exp into the returned user object', () => {
    const result = strategy.validate({
      sub: 'uuid-1',
      email: 'foo@bar.com',
      role: UserRole.SELLER,
      iat: 1000,
      exp: 2000,
    });

    expect(result).not.toHaveProperty('sub');
    expect(result).not.toHaveProperty('iat');
    expect(result).not.toHaveProperty('exp');
  });
});
