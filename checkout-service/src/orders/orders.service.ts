import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CartService } from '../cart/cart.service';
import { PaymentQueueService } from '../events/payment-queue/payment-queue.service';
import { CheckoutDto } from './dto/checkout.dto';
import { Order, OrderStatus } from './entities/order.entity';

const ACTIVE_CART_REQUIRED_MESSAGE =
  'Não há carrinho ativo com itens para finalizar.';
const ORDER_NOT_FOUND_MESSAGE = 'Pedido não encontrado.';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly cartService: CartService,
    private readonly paymentQueue: PaymentQueueService,
  ) {}

  async checkout(userId: string, dto: CheckoutDto): Promise<Order> {
    const cart = await this.cartService.getActiveCart(userId);
    if (!cart || cart.items.length === 0) {
      throw new UnprocessableEntityException(ACTIVE_CART_REQUIRED_MESSAGE);
    }

    const order = await this.orderRepository.save(
      this.orderRepository.create({
        userId,
        cartId: cart.id,
        total: cart.total,
        paymentMethod: dto.paymentMethod,
        status: OrderStatus.PENDING,
      }),
    );

    await this.cartService.markAsCompleted(cart);

    await this.paymentQueue.publishPaymentOrder({
      orderId: order.id,
      userId,
      amount: order.total,
      paymentMethod: order.paymentMethod,
      items: cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      })),
    });

    return order;
  }

  findAll(userId: string): Promise<Order[]> {
    return this.orderRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id, userId },
    });
    if (!order) {
      throw new NotFoundException(ORDER_NOT_FOUND_MESSAGE);
    }
    return order;
  }
}
