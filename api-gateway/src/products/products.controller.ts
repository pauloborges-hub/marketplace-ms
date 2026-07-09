import { Controller, Get, Headers, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { ProxyService } from '../proxy/service/proxy.service';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly proxyService: ProxyService) {}

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
