import {
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ProductNotFoundError,
  ProductResponse,
  ProductsClientService,
  ProductsServiceUnavailableError,
} from '../products-client/products-client.service';
import { CartService } from './cart.service';
import { CartItem } from './entities/cart-item.entity';
import { Cart, CartStatus } from './entities/cart.entity';

describe('CartService', () => {
  let service: CartService;
  let cartRepository: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let cartItemRepository: {
    findOne: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
  };
  let productsClient: { findProduct: jest.Mock };

  const userId = 'user-uuid';
  const productId = '11111111-1111-1111-1111-111111111111';

  const activeProduct: ProductResponse = {
    id: productId,
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 10.5,
    stock: 10,
    isActive: true,
    sellerId: '22222222-2222-2222-2222-222222222222',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    cartRepository = {
      findOne: jest.fn(),
      create: jest.fn((entity: Partial<Cart>) => ({ ...entity })),
      save: jest.fn((entity: Cart) =>
        Promise.resolve({ id: 'cart-uuid', ...entity }),
      ),
    };
    cartItemRepository = {
      findOne: jest.fn(),
      create: jest.fn((entity: Partial<CartItem>) => ({ ...entity })),
      remove: jest.fn(() => Promise.resolve()),
    };
    productsClient = { findProduct: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: getRepositoryToken(Cart), useValue: cartRepository },
        { provide: getRepositoryToken(CartItem), useValue: cartItemRepository },
        { provide: ProductsClientService, useValue: productsClient },
      ],
    }).compile();

    service = module.get(CartService);
  });

  describe('addItem', () => {
    it('snapshots productName/price, sets subtotal = price*quantity and total = sum (CA4/CA6)', async () => {
      cartRepository.findOne.mockResolvedValue(null);
      productsClient.findProduct.mockResolvedValue(activeProduct);

      const result = await service.addItem(userId, { productId, quantity: 2 });

      expect(cartItemRepository.create).toHaveBeenCalledWith({
        productId,
        productName: 'Wireless Mouse',
        price: 10.5,
        quantity: 2,
        subtotal: 21,
      });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].subtotal).toBe(21);
      expect(result.total).toBe(21);
      expect(cartRepository.save).toHaveBeenCalledTimes(1);
    });

    it('merges quantity into the existing item using the stored price, not a fresh one (CA5)', async () => {
      const existingItem = {
        id: 'item-1',
        productId,
        productName: 'Wireless Mouse',
        price: 10.5,
        quantity: 2,
        subtotal: 21,
      } as CartItem;
      const existingCart = {
        id: 'cart-1',
        userId,
        status: CartStatus.ACTIVE,
        total: 21,
        items: [existingItem],
      } as Cart;
      cartRepository.findOne.mockResolvedValue(existingCart);
      // products-service now reports a different price — it must be ignored.
      productsClient.findProduct.mockResolvedValue({
        ...activeProduct,
        price: 999,
      });

      const result = await service.addItem(userId, { productId, quantity: 3 });

      expect(cartItemRepository.create).not.toHaveBeenCalled();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].quantity).toBe(5);
      expect(result.items[0].price).toBe(10.5);
      expect(result.items[0].subtotal).toBe(52.5);
      expect(result.total).toBe(52.5);
    });

    it('rejects an inactive product with 422 and never touches the cart (CA9)', async () => {
      productsClient.findProduct.mockResolvedValue({
        ...activeProduct,
        isActive: false,
      });

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(cartRepository.findOne).not.toHaveBeenCalled();
      expect(cartRepository.save).not.toHaveBeenCalled();
    });

    it('maps a missing product to 404 and never touches the cart (CA8)', async () => {
      productsClient.findProduct.mockRejectedValue(
        new ProductNotFoundError(productId),
      );

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartRepository.save).not.toHaveBeenCalled();
    });

    it('maps an unavailable products-service to 503 and never touches the cart (CA10)', async () => {
      productsClient.findProduct.mockRejectedValue(
        new ProductsServiceUnavailableError(productId),
      );

      await expect(
        service.addItem(userId, { productId, quantity: 1 }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(cartRepository.save).not.toHaveBeenCalled();
    });
  });

  describe('getCart', () => {
    it('returns an empty, non-persisted cart when the user has no active cart (CA11)', async () => {
      cartRepository.findOne.mockResolvedValue(null);

      const result = await service.getCart(userId);

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.userId).toBe(userId);
      expect(cartRepository.save).not.toHaveBeenCalled();
    });

    it('returns the existing active cart with its items and total (CA12)', async () => {
      const cart = {
        id: 'cart-1',
        userId,
        status: CartStatus.ACTIVE,
        total: 21,
        items: [{ id: 'item-1', subtotal: 21 }],
      } as Cart;
      cartRepository.findOne.mockResolvedValue(cart);

      const result = await service.getCart(userId);

      expect(result).toBe(cart);
      expect(cartRepository.findOne).toHaveBeenCalledWith({
        where: { userId, status: CartStatus.ACTIVE },
      });
    });
  });

  describe('removeItem', () => {
    it('removes an owned item and recalculates the total from the remaining items (CA14)', async () => {
      const item = {
        id: 'item-1',
        cart: { id: 'cart-1', userId },
      } as CartItem;
      cartItemRepository.findOne.mockResolvedValue(item);
      cartRepository.findOne.mockResolvedValue({
        id: 'cart-1',
        userId,
        status: CartStatus.ACTIVE,
        total: 99,
        items: [{ id: 'item-2', subtotal: 15 } as CartItem],
      } as Cart);

      const result = await service.removeItem(userId, 'item-1');

      expect(cartItemRepository.remove).toHaveBeenCalledWith(item);
      expect(result.total).toBe(15);
    });

    it('recalculates to zero when the removed item was the last one (CA15)', async () => {
      const item = { id: 'item-1', cart: { id: 'cart-1', userId } } as CartItem;
      cartItemRepository.findOne.mockResolvedValue(item);
      cartRepository.findOne.mockResolvedValue({
        id: 'cart-1',
        userId,
        status: CartStatus.ACTIVE,
        total: 15,
        items: [],
      } as Cart);

      const result = await service.removeItem(userId, 'item-1');

      expect(result.total).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('rejects with 404 when the item belongs to another user, without removing it (CA17)', async () => {
      cartItemRepository.findOne.mockResolvedValue({
        id: 'item-1',
        cart: { id: 'cart-1', userId: 'other-user' },
      } as CartItem);

      await expect(
        service.removeItem(userId, 'item-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartItemRepository.remove).not.toHaveBeenCalled();
    });

    it('rejects with 404 when the item does not exist (CA16)', async () => {
      cartItemRepository.findOne.mockResolvedValue(null);

      await expect(
        service.removeItem(userId, 'item-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cartItemRepository.remove).not.toHaveBeenCalled();
    });
  });
});
