import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CartService } from '../cart/cart.service';
import { CartItem } from '../cart/entities/cart-item.entity';
import { Cart, CartStatus } from '../cart/entities/cart.entity';
import { PaymentQueueService } from '../events/payment-queue/payment-queue.service';
import { PaymentMethod } from './dto/checkout.dto';
import { Order, OrderStatus } from './entities/order.entity';
import { OrdersService } from './orders.service';

describe('OrdersService', () => {
  let service: OrdersService;
  let orderRepository: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let cartService: { getActiveCart: jest.Mock; markAsCompleted: jest.Mock };
  let paymentQueue: { publishPaymentOrder: jest.Mock };

  const userId = 'user-uuid';

  const buildCart = (items: Partial<CartItem>[]): Cart =>
    ({
      id: 'cart-uuid',
      userId,
      status: CartStatus.ACTIVE,
      total: 42,
      items,
    }) as Cart;

  beforeEach(async () => {
    orderRepository = {
      create: jest.fn((entity: Partial<Order>) => ({ ...entity })),
      save: jest.fn((entity: Order) =>
        Promise.resolve({ id: 'order-uuid', ...entity }),
      ),
      find: jest.fn(),
      findOne: jest.fn(),
    };
    cartService = {
      getActiveCart: jest.fn(),
      markAsCompleted: jest.fn(() => Promise.resolve()),
    };
    paymentQueue = { publishPaymentOrder: jest.fn(() => Promise.resolve()) };

    const module = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: CartService, useValue: cartService },
        { provide: PaymentQueueService, useValue: paymentQueue },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('checkout', () => {
    it('creates a pending order from the active cart and publishes it once (CA1/CA3/CA4)', async () => {
      const cart = buildCart([
        {
          productId: 'prod-1',
          quantity: 2,
          price: 10,
        },
        {
          productId: 'prod-2',
          quantity: 1,
          price: 22,
        },
      ]);
      cartService.getActiveCart.mockResolvedValue(cart);

      const result = await service.checkout(userId, {
        paymentMethod: PaymentMethod.PIX,
      });

      expect(orderRepository.create).toHaveBeenCalledWith({
        userId,
        cartId: 'cart-uuid',
        total: 42,
        paymentMethod: PaymentMethod.PIX,
        status: OrderStatus.PENDING,
      });
      expect(result).toMatchObject({
        id: 'order-uuid',
        userId,
        cartId: 'cart-uuid',
        total: 42,
        paymentMethod: PaymentMethod.PIX,
        status: OrderStatus.PENDING,
      });

      expect(cartService.markAsCompleted).toHaveBeenCalledWith(cart);

      expect(paymentQueue.publishPaymentOrder).toHaveBeenCalledTimes(1);
      expect(paymentQueue.publishPaymentOrder).toHaveBeenCalledWith({
        orderId: 'order-uuid',
        userId,
        amount: 42,
        paymentMethod: PaymentMethod.PIX,
        items: [
          { productId: 'prod-1', quantity: 2, price: 10 },
          { productId: 'prod-2', quantity: 1, price: 22 },
        ],
      });
    });

    it('rejects with 422 and creates nothing when there is no active cart (CA6)', async () => {
      cartService.getActiveCart.mockResolvedValue(null);

      await expect(
        service.checkout(userId, { paymentMethod: PaymentMethod.CREDIT_CARD }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(orderRepository.save).not.toHaveBeenCalled();
      expect(cartService.markAsCompleted).not.toHaveBeenCalled();
      expect(paymentQueue.publishPaymentOrder).not.toHaveBeenCalled();
    });

    it('rejects with 422 and creates nothing when the active cart has no items (CA7)', async () => {
      cartService.getActiveCart.mockResolvedValue(buildCart([]));

      await expect(
        service.checkout(userId, { paymentMethod: PaymentMethod.BOLETO }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      expect(orderRepository.save).not.toHaveBeenCalled();
      expect(cartService.markAsCompleted).not.toHaveBeenCalled();
      expect(paymentQueue.publishPaymentOrder).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('returns the user orders ordered by creation date descending (CA8)', async () => {
      const orders = [{ id: 'o2' }, { id: 'o1' }] as Order[];
      orderRepository.find.mockResolvedValue(orders);

      const result = await service.findAll(userId);

      expect(orderRepository.find).toHaveBeenCalledWith({
        where: { userId },
        order: { createdAt: 'DESC' },
      });
      expect(result).toBe(orders);
    });

    it('returns an empty list when the user has no orders (CA9)', async () => {
      orderRepository.find.mockResolvedValue([]);

      await expect(service.findAll(userId)).resolves.toEqual([]);
    });
  });

  describe('findOne', () => {
    it('returns the order when it exists and belongs to the user (CA11)', async () => {
      const order = { id: 'order-uuid', userId } as Order;
      orderRepository.findOne.mockResolvedValue(order);

      const result = await service.findOne(userId, 'order-uuid');

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'order-uuid', userId },
      });
      expect(result).toBe(order);
    });

    it('rejects with 404 when no order matches the id/owner (CA12/CA13)', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOne(userId, 'order-uuid'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
