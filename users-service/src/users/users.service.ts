import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, UserStatus } from './entities/user.entity';

const USER_NOT_FOUND_MESSAGE = 'Usuário não encontrado.';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async findById(id: string): Promise<Omit<User, 'password'>> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(USER_NOT_FOUND_MESSAGE);
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, ...safeUser } = user;
    return safeUser;
  }

  async findActiveSellers(): Promise<Omit<User, 'password'>[]> {
    const sellers = await this.userRepository.find({
      where: { role: UserRole.SELLER, status: UserStatus.ACTIVE },
    });

    return sellers.map((seller) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { password, ...safeUser } = seller;
      return safeUser;
    });
  }
}
