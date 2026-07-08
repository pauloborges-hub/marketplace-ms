import { ForbiddenException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  let repository: {
    create: jest.Mock<Partial<Product>, [Partial<Product>]>;
    save: jest.Mock<Promise<Product>, [Partial<Product>]>;
  };

  const validDto: CreateProductDto = {
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 99.9,
    stock: 10,
  };

  const seller: AuthenticatedUser = {
    id: 'seller-uuid',
    email: 'seller@example.com',
    role: 'seller',
  };

  const buyer: AuthenticatedUser = {
    id: 'buyer-uuid',
    email: 'buyer@example.com',
    role: 'buyer',
  };

  beforeEach(async () => {
    repository = {
      create: jest.fn((entity: Partial<Product>) => entity),
      save: jest.fn((entity: Partial<Product>) =>
        Promise.resolve({
          id: 'product-uuid',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...entity,
        } as Product),
      ),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: getRepositoryToken(Product), useValue: repository },
      ],
    }).compile();

    service = module.get(ProductsService);
  });

  it('creates the product for an authenticated seller, deriving sellerId from the user and forcing isActive true', async () => {
    const result = await service.create(validDto, seller);

    expect(repository.create).toHaveBeenCalledWith({
      ...validDto,
      sellerId: 'seller-uuid',
      isActive: true,
    });
    expect(repository.save).toHaveBeenCalled();
    expect(result.sellerId).toBe('seller-uuid');
    expect(result.isActive).toBe(true);
  });

  it('throws ForbiddenException for a buyer and never touches the repository', async () => {
    await expect(service.create(validDto, buyer)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('overwrites any sellerId/isActive present on the input, using the authenticated user instead', async () => {
    const tamperedDto = {
      ...validDto,
      sellerId: 'someone-else-uuid',
      isActive: false,
    } as CreateProductDto;

    const result = await service.create(tamperedDto, seller);

    expect(result.sellerId).toBe('seller-uuid');
    expect(result.isActive).toBe(true);
  });
});
