import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../users/entities/user.entity';
import { omitPassword } from '../users/utils/omit-password.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const SALT_ROUNDS = 10;
const INVALID_CREDENTIALS_MESSAGE = 'Credenciais inválidas';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto): Promise<Omit<User, 'password'>> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('E-mail já cadastrado.');
    }

    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUNDS);

    const user = this.userRepository.create({
      email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
      role: dto.role,
      status: UserStatus.ACTIVE,
    });

    const saved = await this.userRepository.save(user);
    return omitPassword(saved);
  }

  async login(
    dto: LoginDto,
  ): Promise<{ user: Omit<User, 'password'>; token: string }> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.userRepository.findOne({ where: { email } });
    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('Conta inativa');
    }

    const token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    return { user: omitPassword(user), token };
  }
}
