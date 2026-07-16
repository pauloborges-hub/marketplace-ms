import { Controller, Get, Param, ParseUUIDPipe, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { Order } from './entities/order.entity';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  findAll(@Req() req: Request & { user: AuthenticatedUser }): Promise<Order[]> {
    return this.ordersService.findAll(req.user.id);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ): Promise<Order> {
    return this.ordersService.findOne(req.user.id, id);
  }
}
