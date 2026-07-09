import { Test, TestingModule } from '@nestjs/testing';

import { ProxyService } from '../proxy/service/proxy.service';
import { UsersController } from './users.controller';
import { LoginDto } from '../auth/dtos/login.dto';
import { RegisterDto } from '../auth/dtos/register.dto';

describe('UsersController', () => {
  let controller: UsersController;
  let proxyService: { proxyRequest: jest.Mock };

  beforeEach(async () => {
    proxyService = { proxyRequest: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
  });

  it('proxies POST /auth/register without authorization or user', async () => {
    const dto: RegisterDto = {
      email: 'user@example.com',
      password: 'password123',
      firstName: 'João',
      lastName: 'Silva',
    };

    await controller.register(dto);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'POST',
      '/auth/register',
      dto,
    );
  });

  it('proxies POST /auth/login without authorization or user', async () => {
    const dto: LoginDto = { email: 'user@example.com', password: 'password123' };

    await controller.login(dto);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'POST',
      '/auth/login',
      dto,
    );
  });

  it('proxies GET /auth/validate-token with authorization and user', async () => {
    const user = { userId: 'user-1', email: 'user@example.com', role: 'buyer' };

    await controller.validateToken('Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'GET',
      '/auth/validate-token',
      undefined,
      { authorization: 'Bearer token' },
      user,
    );
  });

  it('proxies GET /users/profile with authorization and user', async () => {
    const user = { userId: 'user-1', email: 'user@example.com', role: 'buyer' };

    await controller.getProfile('Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'GET',
      '/users/profile',
      undefined,
      { authorization: 'Bearer token' },
      user,
    );
  });

  it('proxies GET /users/sellers with authorization and user', async () => {
    const user = { userId: 'user-1', email: 'user@example.com', role: 'buyer' };

    await controller.getSellers('Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'GET',
      '/users/sellers',
      undefined,
      { authorization: 'Bearer token' },
      user,
    );
  });

  it('proxies GET /users/:id with authorization and user', async () => {
    const user = { userId: 'user-1', email: 'user@example.com', role: 'buyer' };

    await controller.getById('user-2', 'Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'users',
      'GET',
      '/users/user-2',
      undefined,
      { authorization: 'Bearer token' },
      user,
    );
  });
});
