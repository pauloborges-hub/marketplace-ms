import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

describe('AuthService', () => {
  let service: AuthService;
  let repository: {
    findOne: jest.Mock<Promise<User | null>, unknown[]>;
    create: jest.Mock<Partial<User>, [Partial<User>]>;
    save: jest.Mock<Promise<User>, [Partial<User>]>;
  };
  let jwtService: { signAsync: jest.Mock<Promise<string>, [object]> };

  const validDto: RegisterDto = {
    email: 'foo@bar.com',
    password: 'secret1',
    firstName: 'Foo',
    lastName: 'Bar',
    role: UserRole.BUYER,
  };

  beforeEach(async () => {
    repository = {
      findOne: jest.fn<Promise<User | null>, unknown[]>(),
      create: jest.fn((entity: Partial<User>) => entity),
      save: jest.fn((entity: Partial<User>) =>
        Promise.resolve({
          id: 'uuid',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        } as User),
      ),
    };

    jwtService = {
      signAsync: jest
        .fn<Promise<string>, [object]>()
        .mockResolvedValue('signed-jwt-token'),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repository },
        { provide: JwtService, useValue: jwtService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('registers a new user without exposing the password and forcing active status', async () => {
    repository.findOne.mockResolvedValue(null);

    const result = await service.register(validDto);

    expect(repository.findOne).toHaveBeenCalledWith({
      where: { email: 'foo@bar.com' },
    });
    expect(result).not.toHaveProperty('password');
    expect(result.status).toBe(UserStatus.ACTIVE);
  });

  it('throws ConflictException when the email already exists, ignoring case, and never saves', async () => {
    repository.findOne.mockResolvedValue({ id: 'existing' } as User);

    await expect(
      service.register({ ...validDto, email: 'Foo@Bar.com' }),
    ).rejects.toThrow(ConflictException);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('stores the password as a verifiable bcrypt hash, never in plain text', async () => {
    repository.findOne.mockResolvedValue(null);

    await service.register(validDto);

    const hashedPassword = repository.create.mock.calls[0][0].password;
    expect(hashedPassword).not.toBe(validDto.password);
    expect(hashedPassword).toMatch(/^\$2[aby]\$\d{2}\$/);
    await expect(
      bcrypt.compare(validDto.password, hashedPassword as string),
    ).resolves.toBe(true);
  });

  describe('login', () => {
    const loginDto: LoginDto = { email: 'foo@bar.com', password: 'secret1' };

    const buildUser = (overrides: Partial<User> = {}): User => ({
      id: 'uuid',
      email: 'foo@bar.com',
      password: bcrypt.hashSync('secret1', 10),
      firstName: 'Foo',
      lastName: 'Bar',
      role: UserRole.BUYER,
      status: UserStatus.ACTIVE,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    });

    it('returns the user (without password) and a signed token when credentials are correct and the account is active', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      const result = await service.login(loginDto);

      expect(result).not.toHaveProperty('user.password');
      expect(result.user).not.toHaveProperty('password');
      expect(result.token).toBe('signed-jwt-token');
    });

    it('signs the JWT with exactly sub, email and role from the authenticated user', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      await service.login(loginDto);

      expect(jwtService.signAsync).toHaveBeenCalledWith({
        sub: 'uuid',
        email: 'foo@bar.com',
        role: UserRole.BUYER,
      });
    });

    it('finds the user by email normalized to lowercase, case-insensitively', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      await service.login({ ...loginDto, email: 'Foo@Bar.com' });

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'foo@bar.com' },
      });
    });

    it('throws UnauthorizedException with "Credenciais inválidas" when the email does not exist', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Credenciais inválidas'),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException with "Credenciais inválidas" when the password is incorrect, same message as unknown email', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      await expect(
        service.login({ ...loginDto, password: 'wrong-password' }),
      ).rejects.toThrow(new UnauthorizedException('Credenciais inválidas'));
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException with "Conta inativa" when credentials are correct but the account is inactive', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ status: UserStatus.INACTIVE }),
      );

      await expect(service.login(loginDto)).rejects.toThrow(
        new UnauthorizedException('Conta inativa'),
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });

    it('checks the password before the account status, so an incorrect password never reveals an inactive account', async () => {
      repository.findOne.mockResolvedValue(
        buildUser({ status: UserStatus.INACTIVE }),
      );

      await expect(
        service.login({ ...loginDto, password: 'wrong-password' }),
      ).rejects.toThrow(new UnauthorizedException('Credenciais inválidas'));
    });
  });
});
