import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../auth/decorators/public.decorator';
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

  @Public()
  @Get()
  getProducts() {
    return this.productsService.findActiveProducts();
  }

  @Public()
  @Get('seller/:sellerId')
  getBySeller(@Param('sellerId', ParseUUIDPipe) sellerId: string) {
    return this.productsService.findActiveBySeller(sellerId);
  }

  @Public()
  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findById(id);
  }
}
