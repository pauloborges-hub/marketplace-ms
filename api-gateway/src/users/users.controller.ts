import { Controller, Get, Headers, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';

interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
}

@ApiTags('Users')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get('profile')
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

  @Get('sellers')
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

  @Get(':id')
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
