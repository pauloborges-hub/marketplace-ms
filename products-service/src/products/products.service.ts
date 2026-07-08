import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
  ) {}

  async create(
    dto: CreateProductDto,
    user: AuthenticatedUser,
  ): Promise<Product> {
    if (user.role !== 'seller') {
      throw new ForbiddenException(
        'Apenas vendedores podem cadastrar produtos.',
      );
    }

    const product = this.productRepository.create({
      ...dto,
      sellerId: user.id,
      isActive: true,
    });

    return this.productRepository.save(product);
  }
}
