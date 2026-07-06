import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '../../users/entities/user.entity';

export class RegisterDto {
  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @MinLength(6)
  password: string;

  @IsNotEmpty()
  @MaxLength(100)
  firstName: string;

  @IsNotEmpty()
  @MaxLength(100)
  lastName: string;

  @IsEnum(UserRole)
  role: UserRole;
}
