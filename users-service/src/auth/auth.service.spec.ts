import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { User, UserRole, UserStatus } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';

describe('AuthService', () => {
  let service: AuthService;
  let repository: {
    findOne: jest.Mock<Promise<User | null>, unknown[]>;
    create: jest.Mock<Partial<User>, [Partial<User>]>;
    save: jest.Mock<Promise<User>, [Partial<User>]>;
  };

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

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: repository },
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
});
