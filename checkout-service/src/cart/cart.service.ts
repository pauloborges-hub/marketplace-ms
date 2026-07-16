import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ProductNotFoundError,
  ProductResponse,
  ProductsClientService,
  ProductsServiceUnavailableError,
} from '../products-client/products-client.service';
import { AddCartItemDto } from './dto/add-cart-item.dto';
import { CartItem } from './entities/cart-item.entity';
import { Cart, CartStatus } from './entities/cart.entity';

const CART_ITEM_NOT_FOUND_MESSAGE = 'Item não encontrado no carrinho.';

@Injectable()
export class CartService {
  constructor(
    @InjectRepository(Cart)
    private readonly cartRepository: Repository<Cart>,
    @InjectRepository(CartItem)
    private readonly cartItemRepository: Repository<CartItem>,
    private readonly productsClient: ProductsClientService,
  ) {}

  async addItem(userId: string, dto: AddCartItemDto): Promise<Cart> {
    const product = await this.fetchActiveProduct(dto.productId);
    const cart = await this.getOrCreateActiveCart(userId);

    const existingItem = cart.items.find(
      (item) => item.productId === product.id,
    );

    if (existingItem) {
      existingItem.quantity += dto.quantity;
      existingItem.subtotal = existingItem.price * existingItem.quantity;
    } else {
      cart.items.push(
        this.cartItemRepository.create({
          productId: product.id,
          productName: product.name,
          price: product.price,
          quantity: dto.quantity,
          subtotal: product.price * dto.quantity,
        }),
      );
    }

    cart.total = this.calculateTotal(cart.items);
    return this.cartRepository.save(cart);
  }

  async getCart(userId: string): Promise<Cart> {
    const cart = await this.getActiveCart(userId);
    return cart ?? this.buildEmptyCart(userId);
  }

  getActiveCart(userId: string): Promise<Cart | null> {
    return this.cartRepository.findOne({
      where: { userId, status: CartStatus.ACTIVE },
    });
  }

  markAsCompleted(cart: Cart): Promise<Cart> {
    cart.status = CartStatus.COMPLETED;
    return this.cartRepository.save(cart);
  }

  async removeItem(userId: string, itemId: string): Promise<Cart> {
    const item = await this.cartItemRepository.findOne({
      where: { id: itemId },
      relations: { cart: true },
    });

    if (!item || item.cart.userId !== userId) {
      throw new NotFoundException(CART_ITEM_NOT_FOUND_MESSAGE);
    }

    const { id: cartId } = item.cart;
    await this.cartItemRepository.remove(item);

    const cart = await this.cartRepository.findOne({ where: { id: cartId } });
    if (!cart) {
      return this.buildEmptyCart(userId);
    }

    cart.total = this.calculateTotal(cart.items);
    return this.cartRepository.save(cart);
  }

  private async fetchActiveProduct(
    productId: string,
  ): Promise<ProductResponse> {
    let product: ProductResponse;
    try {
      product = await this.productsClient.findProduct(productId);
    } catch (error) {
      if (error instanceof ProductNotFoundError) {
        throw new NotFoundException(error.message);
      }
      if (error instanceof ProductsServiceUnavailableError) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }

    if (!product.isActive) {
      throw new UnprocessableEntityException(
        `Produto ${productId} está inativo e não pode ser adicionado ao carrinho.`,
      );
    }

    return product;
  }

  private async getOrCreateActiveCart(userId: string): Promise<Cart> {
    const existing = await this.getActiveCart(userId);
    return existing ?? this.buildEmptyCart(userId);
  }

  private buildEmptyCart(userId: string): Cart {
    return this.cartRepository.create({
      userId,
      status: CartStatus.ACTIVE,
      total: 0,
      items: [],
    });
  }

  private calculateTotal(items: CartItem[]): number {
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    return Math.round(total * 100) / 100;
  }
}
