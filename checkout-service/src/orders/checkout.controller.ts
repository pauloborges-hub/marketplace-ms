import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CheckoutDto } from './dto/checkout.dto';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Controller('cart')
export class CheckoutController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post('checkout')
  checkout(
    @Body() dto: CheckoutDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<Order> {
    return this.ordersService.checkout(req.user.id, dto);
  }
}
