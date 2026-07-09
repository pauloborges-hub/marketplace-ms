import { Test, TestingModule } from '@nestjs/testing';

import { ProxyService } from '../proxy/service/proxy.service';
import { ProductsController } from './products.controller';
import { CreateProductDto } from './dto/create-product.dto';

describe('ProductsController', () => {
  let controller: ProductsController;
  let proxyService: { proxyRequest: jest.Mock };

  beforeEach(async () => {
    proxyService = { proxyRequest: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProductsController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    }).compile();

    controller = module.get<ProductsController>(ProductsController);
  });

  it('proxies GET /products', async () => {
    await controller.getProducts('Bearer token');

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'GET',
      '/products',
      undefined,
      { authorization: 'Bearer token' },
    );
  });

  it('proxies GET /products/seller/:sellerId', async () => {
    await controller.getBySeller('seller-1', 'Bearer token');

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'GET',
      '/products/seller/seller-1',
      undefined,
      { authorization: 'Bearer token' },
    );
  });

  it('proxies GET /products/:id', async () => {
    await controller.getById('product-1', 'Bearer token');

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'GET',
      '/products/product-1',
      undefined,
      { authorization: 'Bearer token' },
    );
  });

  it('proxies POST /products with the body, authorization header and user', async () => {
    const dto: CreateProductDto = {
      name: 'Product',
      description: 'Description',
      price: 10,
      stock: 5,
    };
    const user = { userId: 'seller-1', email: 'seller@test.com', role: 'seller' };

    await controller.createProduct(dto, 'Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'products',
      'POST',
      '/products',
      dto,
      { authorization: 'Bearer token' },
      user,
    );
  });
});
