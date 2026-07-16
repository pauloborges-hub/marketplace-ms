import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { PaymentQueueService } from '../src/events/payment-queue/payment-queue.service';
import { Order } from '../src/orders/entities/order.entity';
import {
  ProductResponse,
  ProductsClientService,
} from '../src/products-client/products-client.service';
import { createTestApp } from './utils/create-test-app';
import { signToken } from './utils/sign-token';

type Auth = { Authorization: string };

describe('Order checkout (e2e)', () => {
  let app: INestApplication<App>;
  let orderRepository: Repository<Order>;
  const productsClient = { findProduct: jest.fn() };
  const paymentQueue = { publishPaymentOrder: jest.fn() };

  const bearer = (role: 'seller' | 'buyer', userId?: string): Auth => ({
    Authorization: `Bearer ${signToken(role, userId)}`,
  });

  const buildProduct = (
    overrides: Partial<ProductResponse> = {},
  ): ProductResponse => ({
    id: randomUUID(),
    name: 'Wireless Mouse',
    description: 'Ergonomic wireless mouse',
    price: 10.5,
    stock: 10,
    isActive: true,
    sellerId: randomUUID(),
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  });

  const addItem = (
    auth: Auth,
    product: ProductResponse,
    quantity = 1,
  ): request.Test => {
    productsClient.findProduct.mockResolvedValueOnce(product);
    return request(app.getHttpServer())
      .post('/cart/items')
      .set(auth)
      .send({ productId: product.id, quantity })
      .expect(201);
  };

  const createOrder = async (
    auth: Auth,
    paymentMethod = 'pix',
  ): Promise<request.Response> => {
    await addItem(auth, buildProduct());
    return request(app.getHttpServer())
      .post('/cart/checkout')
      .set(auth)
      .send({ paymentMethod })
      .expect(201);
  };

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder
        .overrideProvider(ProductsClientService)
        .useValue(productsClient)
        .overrideProvider(PaymentQueueService)
        .useValue(paymentQueue),
    );
    orderRepository = app.get<Repository<Order>>(getRepositoryToken(Order));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    productsClient.findProduct.mockReset();
    paymentQueue.publishPaymentOrder.mockReset();
  });

  describe('POST /cart/checkout', () => {
    it('creates a pending order, completes the cart and publishes once (CA1/CA2/CA3/CA4)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const product = buildProduct({ price: 10.5 });
      await addItem(auth, product, 2);

      const res = await request(app.getHttpServer())
        .post('/cart/checkout')
        .set(auth)
        .send({ paymentMethod: 'pix' })
        .expect(201);

      expect(res.body).toMatchObject({
        userId,
        total: 21,
        paymentMethod: 'pix',
        status: 'pending',
      });
      expect(res.body.id).toBeDefined();
      expect(res.body.cartId).toBeDefined();

      // CA2: the used cart is completed — GET /cart now yields a fresh empty cart.
      const cartRes = await request(app.getHttpServer())
        .get('/cart')
        .set(auth)
        .expect(200);
      expect(cartRes.body.items).toEqual([]);
      expect(cartRes.body.total).toBe(0);

      // CA3: published exactly once with a message mirroring the order/cart.
      expect(paymentQueue.publishPaymentOrder).toHaveBeenCalledTimes(1);
      expect(paymentQueue.publishPaymentOrder).toHaveBeenCalledWith({
        orderId: res.body.id,
        userId,
        amount: 21,
        paymentMethod: 'pix',
        items: [{ productId: product.id, quantity: 2, price: 10.5 }],
      });
    });

    it('rejects a missing/invalid paymentMethod with 400, changing nothing (CA5)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      await addItem(auth, buildProduct());

      const invalidBodies = [
        {},
        { paymentMethod: 'bitcoin' },
        { paymentMethod: '' },
        { paymentMethod: 'pix', unexpected: 'x' },
      ];
      for (const body of invalidBodies) {
        await request(app.getHttpServer())
          .post('/cart/checkout')
          .set(auth)
          .send(body)
          .expect(400);
      }

      expect(paymentQueue.publishPaymentOrder).not.toHaveBeenCalled();
      expect(await orderRepository.find({ where: { userId } })).toHaveLength(0);
      const cartRes = await request(app.getHttpServer())
        .get('/cart')
        .set(auth)
        .expect(200);
      expect(cartRes.body.items).toHaveLength(1);
    });

    it('rejects checkout with 422 when there is no active cart, creating nothing (CA6)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);

      await request(app.getHttpServer())
        .post('/cart/checkout')
        .set(auth)
        .send({ paymentMethod: 'pix' })
        .expect(422);

      expect(paymentQueue.publishPaymentOrder).not.toHaveBeenCalled();
      expect(await orderRepository.find({ where: { userId } })).toHaveLength(0);
    });

    it('rejects checkout with 422 when the active cart has no items, creating nothing (CA7)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const added = await addItem(auth, buildProduct());
      await request(app.getHttpServer())
        .delete(`/cart/items/${added.body.items[0].id}`)
        .set(auth)
        .expect(200);

      await request(app.getHttpServer())
        .post('/cart/checkout')
        .set(auth)
        .send({ paymentMethod: 'pix' })
        .expect(422);

      expect(paymentQueue.publishPaymentOrder).not.toHaveBeenCalled();
      expect(await orderRepository.find({ where: { userId } })).toHaveLength(0);
    });
  });

  describe('GET /orders', () => {
    it('returns the user orders newest first (CA8)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const first = await createOrder(auth);
      const second = await createOrder(auth);

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set(auth)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe(second.body.id);
      expect(res.body[1].id).toBe(first.body.id);
    });

    it('returns an empty list for a user with no orders (CA9)', async () => {
      const res = await request(app.getHttpServer())
        .get('/orders')
        .set(bearer('buyer', randomUUID()))
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it("never returns another user's orders (CA10)", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      await createOrder(bearer('buyer', owner));

      const res = await request(app.getHttpServer())
        .get('/orders')
        .set(bearer('buyer', other))
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('GET /orders/:id', () => {
    it('returns an owned order by id (CA11)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const created = await createOrder(auth);

      const res = await request(app.getHttpServer())
        .get(`/orders/${created.body.id}`)
        .set(auth)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.userId).toBe(userId);
    });

    it('returns 404 for an id that matches no order (CA12)', async () => {
      await request(app.getHttpServer())
        .get(`/orders/${randomUUID()}`)
        .set(bearer('buyer'))
        .expect(404);
    });

    it('returns 404 for an order that belongs to another user (CA13)', async () => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const created = await createOrder(bearer('buyer', owner));

      await request(app.getHttpServer())
        .get(`/orders/${created.body.id}`)
        .set(bearer('buyer', attacker))
        .expect(404);
    });

    it('returns 400 for a non-UUID id (CA14)', async () => {
      await request(app.getHttpServer())
        .get('/orders/not-a-uuid')
        .set(bearer('buyer'))
        .expect(400);
    });
  });

  describe('role parity and authentication', () => {
    it.each(['seller', 'buyer'] as const)(
      'lets a %s checkout and read their own orders (CA15)',
      async (role) => {
        const userId = randomUUID();
        const auth = bearer(role, userId);
        const created = await createOrder(auth);

        const list = await request(app.getHttpServer())
          .get('/orders')
          .set(auth)
          .expect(200);
        expect(
          list.body.some((o: { id: string }) => o.id === created.body.id),
        ).toBe(true);

        await request(app.getHttpServer())
          .get(`/orders/${created.body.id}`)
          .set(auth)
          .expect(200);
      },
    );

    it('returns 401 for all three endpoints without a valid token (CA16)', async () => {
      await request(app.getHttpServer())
        .post('/cart/checkout')
        .send({ paymentMethod: 'pix' })
        .expect(401);
      await request(app.getHttpServer()).get('/orders').expect(401);
      await request(app.getHttpServer())
        .get(`/orders/${randomUUID()}`)
        .expect(401);
    });
  });
});
