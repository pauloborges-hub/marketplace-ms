import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CartService } from './cart.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';

@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get()
  getCart(@Req() req: Request & { user: AuthenticatedUser }) {
    return this.cartService.getCart(req.user.id);
  }

  @Post('items')
  addItem(
    @Body() dto: AddCartItemDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.cartService.addItem(req.user.id, dto);
  }

  @Delete('items/:itemId')
  removeItem(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.cartService.removeItem(req.user.id, itemId);
  }
}
