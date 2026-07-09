import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/auth.guard';
import { ProxyService } from '../proxy/service/proxy.service';
import { CreateProductDto } from './dto/create-product.dto';

interface AuthenticatedUser {
  userId: string;
  email: string;
  role: string;
}

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly proxyService: ProxyService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criação de produto (somente seller)' })
  createProduct(
    @Body() dto: CreateProductDto,
    @Headers('authorization') authorization: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'products',
      'POST',
      '/products',
      dto,
      { authorization },
      user,
    ) as Promise<unknown>;
  }

  @Get()
  @ApiOperation({ summary: 'Catálogo de produtos ativos' })
  getProducts(
    @Headers('authorization') authorization: string,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'products',
      'GET',
      '/products',
      undefined,
      { authorization },
    ) as Promise<unknown>;
  }

  @Get('seller/:sellerId')
  @ApiOperation({ summary: 'Produtos ativos de um vendedor' })
  getBySeller(
    @Param('sellerId') sellerId: string,
    @Headers('authorization') authorization: string,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'products',
      'GET',
      `/products/seller/${sellerId}`,
      undefined,
      { authorization },
    ) as Promise<unknown>;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consulta de produto por ID' })
  getById(
    @Param('id') id: string,
    @Headers('authorization') authorization: string,
  ): Promise<unknown> {
    return this.proxyService.proxyRequest(
      'products',
      'GET',
      `/products/${id}`,
      undefined,
      { authorization },
    ) as Promise<unknown>;
  }
}
