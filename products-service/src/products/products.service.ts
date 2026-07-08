import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { CreateProductDto } from './dto/create-product.dto';
import { Product } from './entities/product.entity';

const PRODUCT_NOT_FOUND_MESSAGE = 'Produto não encontrado.';

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

  async findActiveProducts(): Promise<Product[]> {
    return this.productRepository.find({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });
  }

  async findActiveBySeller(sellerId: string): Promise<Product[]> {
    return this.productRepository.find({
      where: { sellerId, isActive: true },
    });
  }

  async findById(id: string): Promise<Product> {
    const product = await this.productRepository.findOne({ where: { id } });
    if (!product) {
      throw new NotFoundException(PRODUCT_NOT_FOUND_MESSAGE);
    }

    return product;
  }
}
