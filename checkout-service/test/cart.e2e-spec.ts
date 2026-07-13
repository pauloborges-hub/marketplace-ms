import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { CartItem } from '../src/cart/entities/cart-item.entity';
import { Cart, CartStatus } from '../src/cart/entities/cart.entity';
import {
  ProductNotFoundError,
  ProductResponse,
  ProductsClientService,
  ProductsServiceUnavailableError,
} from '../src/products-client/products-client.service';
import { createTestApp } from './utils/create-test-app';
import { signToken } from './utils/sign-token';

describe('Cart management (e2e)', () => {
  let app: INestApplication<App>;
  let cartRepository: Repository<Cart>;
  const productsClient = { findProduct: jest.fn() };

  const bearer = (role: 'seller' | 'buyer', userId?: string) => ({
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

  beforeAll(async () => {
    app = await createTestApp((builder) =>
      builder.overrideProvider(ProductsClientService).useValue(productsClient),
    );
    cartRepository = app.get<Repository<Cart>>(getRepositoryToken(Cart));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    productsClient.findProduct.mockReset();
  });

  describe('POST /cart/items', () => {
    it('snapshots product data, sets subtotal and total, returns the cart (CA4/CA6)', async () => {
      const userId = randomUUID();
      const product = buildProduct({ price: 10.5 });
      productsClient.findProduct.mockResolvedValue(product);

      const res = await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', userId))
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      expect(productsClient.findProduct).toHaveBeenCalledWith(product.id);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        productId: product.id,
        productName: product.name,
        price: 10.5,
        quantity: 2,
        subtotal: 21,
      });
      expect(res.body.total).toBe(21);
    });

    it('merges quantity for a repeated product using the stored price (CA5)', async () => {
      const userId = randomUUID();
      const product = buildProduct({ price: 10.5 });
      const auth = bearer('buyer', userId);

      productsClient.findProduct.mockResolvedValue(product);
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      // products-service now reports a different price — it must be ignored.
      productsClient.findProduct.mockResolvedValue({ ...product, price: 999 });
      const res = await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: product.id, quantity: 3 })
        .expect(201);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].quantity).toBe(5);
      expect(res.body.items[0].price).toBe(10.5);
      expect(res.body.items[0].subtotal).toBe(52.5);
      expect(res.body.total).toBe(52.5);
    });

    it('rejects an invalid body with 400 before calling products-service (CA7)', async () => {
      const auth = bearer('buyer');
      const invalidBodies = [
        {},
        { productId: 'not-a-uuid', quantity: 1 },
        { productId: randomUUID() },
        { productId: randomUUID(), quantity: 0 },
        { productId: randomUUID(), quantity: 1.5 },
        { productId: randomUUID(), quantity: 2, unexpected: 'x' },
      ];

      for (const body of invalidBodies) {
        await request(app.getHttpServer())
          .post('/cart/items')
          .set(auth)
          .send(body)
          .expect(400);
      }

      expect(productsClient.findProduct).not.toHaveBeenCalled();
    });

    it('returns 404 and creates no cart when the product does not exist (CA8)', async () => {
      const userId = randomUUID();
      const productId = randomUUID();
      productsClient.findProduct.mockRejectedValue(
        new ProductNotFoundError(productId),
      );

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', userId))
        .send({ productId, quantity: 1 })
        .expect(404);

      expect(await cartRepository.findOne({ where: { userId } })).toBeNull();
    });

    it('returns 422 and creates no cart for an inactive product (CA9)', async () => {
      const userId = randomUUID();
      const product = buildProduct({ isActive: false });
      productsClient.findProduct.mockResolvedValue(product);

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', userId))
        .send({ productId: product.id, quantity: 1 })
        .expect(422);

      expect(await cartRepository.findOne({ where: { userId } })).toBeNull();
    });

    it('returns 503 and creates no cart when products-service is unavailable (CA10)', async () => {
      const userId = randomUUID();
      const productId = randomUUID();
      productsClient.findProduct.mockRejectedValue(
        new ProductsServiceUnavailableError(productId),
      );

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', userId))
        .send({ productId, quantity: 1 })
        .expect(503);

      expect(await cartRepository.findOne({ where: { userId } })).toBeNull();
    });

    it('never creates more than one active cart per user (CA19)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const p1 = buildProduct();
      const p2 = buildProduct();

      productsClient.findProduct.mockResolvedValueOnce(p1);
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: p1.id, quantity: 1 })
        .expect(201);

      productsClient.findProduct.mockResolvedValueOnce(p2);
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: p2.id, quantity: 1 })
        .expect(201);

      const carts = await cartRepository.find({
        where: { userId, status: CartStatus.ACTIVE },
      });
      expect(carts).toHaveLength(1);
    });
  });

  describe('GET /cart', () => {
    it('returns an empty cart without persisting when none exists (CA11)', async () => {
      const userId = randomUUID();

      const res = await request(app.getHttpServer())
        .get('/cart')
        .set(bearer('buyer', userId))
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
      expect(await cartRepository.findOne({ where: { userId } })).toBeNull();
    });

    it('returns the active cart with its items and total (CA12)', async () => {
      const userId = randomUUID();
      const auth = bearer('seller', userId);
      const product = buildProduct();
      productsClient.findProduct.mockResolvedValue(product);

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: product.id, quantity: 2 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/cart')
        .set(auth)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(21);
    });

    it("never returns another user's cart (CA13)", async () => {
      const owner = randomUUID();
      const other = randomUUID();
      const product = buildProduct();
      productsClient.findProduct.mockResolvedValue(product);

      await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', owner))
        .send({ productId: product.id, quantity: 1 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/cart')
        .set(bearer('buyer', other))
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  describe('DELETE /cart/items/:itemId', () => {
    it('removes an owned item and recalculates the total (CA14)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const p1 = buildProduct({ price: 10 });
      const p2 = buildProduct({ price: 5 });

      productsClient.findProduct.mockResolvedValueOnce(p1);
      await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: p1.id, quantity: 1 })
        .expect(201);

      productsClient.findProduct.mockResolvedValueOnce(p2);
      const afterSecond = await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: p2.id, quantity: 2 })
        .expect(201);
      expect(afterSecond.body.total).toBe(20);

      const target = afterSecond.body.items.find(
        (i: { productId: string }) => i.productId === p1.id,
      );

      const res = await request(app.getHttpServer())
        .delete(`/cart/items/${target.id}`)
        .set(auth)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].productId).toBe(p2.id);
      expect(res.body.total).toBe(10);
    });

    it('empties the cart when the last item is removed (CA15)', async () => {
      const userId = randomUUID();
      const auth = bearer('buyer', userId);
      const product = buildProduct({ price: 10 });
      productsClient.findProduct.mockResolvedValue(product);

      const added = await request(app.getHttpServer())
        .post('/cart/items')
        .set(auth)
        .send({ productId: product.id, quantity: 1 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/cart/items/${added.body.items[0].id}`)
        .set(auth)
        .expect(200);

      expect(res.body.items).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns 404 for an itemId that does not exist (CA16)', async () => {
      await request(app.getHttpServer())
        .delete(`/cart/items/${randomUUID()}`)
        .set(bearer('buyer'))
        .expect(404);
    });

    it("returns 404 without removing an item owned by another user (CA17)", async () => {
      const owner = randomUUID();
      const attacker = randomUUID();
      const product = buildProduct();
      productsClient.findProduct.mockResolvedValue(product);

      const added = await request(app.getHttpServer())
        .post('/cart/items')
        .set(bearer('buyer', owner))
        .send({ productId: product.id, quantity: 1 })
        .expect(201);
      const itemId = added.body.items[0].id;

      await request(app.getHttpServer())
        .delete(`/cart/items/${itemId}`)
        .set(bearer('buyer', attacker))
        .expect(404);

      const res = await request(app.getHttpServer())
        .get('/cart')
        .set(bearer('buyer', owner))
        .expect(200);
      expect(res.body.items).toHaveLength(1);
    });

    it('returns 400 for a non-UUID itemId (CA18)', async () => {
      await request(app.getHttpServer())
        .delete('/cart/items/not-a-uuid')
        .set(bearer('buyer'))
        .expect(400);
    });
  });

  describe('role parity and authentication', () => {
    it.each(['seller', 'buyer'] as const)(
      'lets a %s add, view and remove items (CA20)',
      async (role) => {
        const userId = randomUUID();
        const auth = bearer(role, userId);
        const product = buildProduct();
        productsClient.findProduct.mockResolvedValue(product);

        const added = await request(app.getHttpServer())
          .post('/cart/items')
          .set(auth)
          .send({ productId: product.id, quantity: 1 })
          .expect(201);

        await request(app.getHttpServer()).get('/cart').set(auth).expect(200);

        await request(app.getHttpServer())
          .delete(`/cart/items/${added.body.items[0].id}`)
          .set(auth)
          .expect(200);
      },
    );

    it('returns 401 for all three endpoints without a valid token (CA21)', async () => {
      await request(app.getHttpServer()).get('/cart').expect(401);
      await request(app.getHttpServer())
        .post('/cart/items')
        .send({ productId: randomUUID(), quantity: 1 })
        .expect(401);
      await request(app.getHttpServer())
        .delete(`/cart/items/${randomUUID()}`)
        .expect(401);
    });
  });
});
