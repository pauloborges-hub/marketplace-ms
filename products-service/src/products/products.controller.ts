import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(
    @Body() dto: CreateProductDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.productsService.create(dto, req.user);
  }
}
