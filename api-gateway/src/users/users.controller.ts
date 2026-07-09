import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { LoginDto } from '../auth/dtos/login.dto';
import { RegisterDto } from '../auth/dtos/register.dto';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
}

@ApiTags('Users')
@Controller()
export class UsersController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post('auth/register')
  @ApiOperation({ summary: 'Registro de usuário' })
  @Throttle({ medium: { limit: 3, ttl: 60000 } })
  register(@Body() dto: RegisterDto): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'POST',
      '/auth/register',
      dto,
    ) as Promise<unknown>;
  }

  @Post('auth/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do usuário' })
  @Throttle({ short: { limit: 5, ttl: 60000 } })
  login(@Body() dto: LoginDto): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'POST',
      '/auth/login',
      dto,
    ) as Promise<unknown>;
  }

  @Get('auth/validate-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Validação do token JWT' })
  validateToken(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'GET',
      '/auth/validate-token',
      undefined,
      { authorization },
      user,
    ) as Promise<unknown>;
  }

  @Get('users/profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Perfil do usuário autenticado' })
  getProfile(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'GET',
      '/users/profile',
      undefined,
      { authorization },
      user,
    ) as Promise<unknown>;
  }

  @Get('users/sellers')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Lista de vendedores ativos' })
  getSellers(
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'GET',
      '/users/sellers',
      undefined,
      { authorization },
      user,
    ) as Promise<unknown>;
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Consulta de usuário por ID' })
  getById(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'users',
      'GET',
      `/users/${id}`,
      undefined,
      { authorization },
      user,
    ) as Promise<unknown>;
  }
}
