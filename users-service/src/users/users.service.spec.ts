import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { User, UserRole, UserStatus } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    findOne: jest.Mock<Promise<User | null>, unknown[]>;
    find: jest.Mock<Promise<User[]>, unknown[]>;
  };

  const buildUser = (overrides: Partial<User> = {}): User => ({
    id: 'uuid',
    email: 'foo@bar.com',
    password: 'hashed-password',
    firstName: 'Foo',
    lastName: 'Bar',
    role: UserRole.BUYER,
    status: UserStatus.ACTIVE,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    repository = {
      findOne: jest.fn<Promise<User | null>, unknown[]>(),
      find: jest.fn<Promise<User[]>, unknown[]>(),
    };

    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: repository },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('returns the user without the password when found', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      const result = await service.findById('uuid');

      expect(result).not.toHaveProperty('password');
      expect(result).toMatchObject({
        id: 'uuid',
        email: 'foo@bar.com',
        firstName: 'Foo',
        lastName: 'Bar',
      });
    });

    it('queries the repository by the exact id received', async () => {
      repository.findOne.mockResolvedValue(buildUser());

      await service.findById('uuid');

      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 'uuid' },
      });
    });

    it('throws NotFoundException when no user exists with the given id', async () => {
      repository.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-uuid')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findActiveSellers', () => {
    it('queries the repository for sellers with active status only', async () => {
      repository.find.mockResolvedValue([]);

      await service.findActiveSellers();

      expect(repository.find).toHaveBeenCalledWith({
        where: { role: UserRole.SELLER, status: UserStatus.ACTIVE },
      });
    });

    it('returns the matched sellers without the password field', async () => {
      repository.find.mockResolvedValue([
        buildUser({ id: 'seller-1', role: UserRole.SELLER }),
        buildUser({ id: 'seller-2', role: UserRole.SELLER }),
      ]);

      const result = await service.findActiveSellers();

      expect(result).toHaveLength(2);
      expect(result[0]).not.toHaveProperty('password');
      expect(result[1]).not.toHaveProperty('password');
    });

    it('returns an empty array when there are no active sellers', async () => {
      repository.find.mockResolvedValue([]);

      const result = await service.findActiveSellers();

      expect(result).toEqual([]);
    });
  });
});
