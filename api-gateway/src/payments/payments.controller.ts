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

@ApiTags('Payments')
@Controller('payments')
export class PaymentsProxyController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get(':orderId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Consulta de pagamento por orderId' })
  getByOrderId(
    @Param('orderId') orderId: string,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'payments',
      'GET',
      `/payments/${orderId}`,
      undefined,
      { authorization },
      user,
    ) as Promise<unknown>;
  }
}
