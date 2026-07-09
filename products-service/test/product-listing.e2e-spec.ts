import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { Product } from '../src/products/entities/product.entity';
import { createTestApp } from './utils/create-test-app';
import { signToken } from './utils/sign-token';

describe('Product listing (e2e)', () => {
  let app: INestApplication<App>;
  let productRepository: Repository<Product>;

  beforeEach(async () => {
    app = await createTestApp();
    productRepository = app.get<Repository<Product>>(
      getRepositoryToken(Product),
    );
  });

  afterEach(async () => {
    await app.close();
  });

  async function createProduct(
    overrides: Partial<Product> & { sellerId: string },
  ): Promise<Product> {
    const product = productRepository.create({
      name: 'Test Product',
      description: 'A product created directly for e2e setup',
      price: 10,
      stock: 1,
      isActive: true,
      ...overrides,
    });

    return productRepository.save(product);
  }

  describe('GET /products', () => {
    it('returns only active products, ordered by createdAt descending, and reflects the same result regardless of auth', async () => {
      const sellerId = randomUUID();
      const older = await createProduct({ sellerId });
      const newer = await createProduct({ sellerId });
      const inactive = await createProduct({ sellerId, isActive: false });

      await productRepository.update(
        { id: older.id },
        { createdAt: new Date('2020-01-01T00:00:00.000Z') },
      );
      await productRepository.update(
        { id: newer.id },
        { createdAt: new Date('2020-01-02T00:00:00.000Z') },
      );

      const assertCatalog = (body: unknown) => {
        const list = body as Array<{ id: string }>;
        expect(Array.isArray(list)).toBe(true);

        const olderIndex = list.findIndex((p) => p.id === older.id);
        const newerIndex = list.findIndex((p) => p.id === newer.id);
        expect(olderIndex).toBeGreaterThanOrEqual(0);
        expect(newerIndex).toBeGreaterThanOrEqual(0);
        expect(newerIndex).toBeLessThan(olderIndex);

        expect(list.some((p) => p.id === inactive.id)).toBe(false);
      };

      const anonymousResponse = await request(app.getHttpServer())
        .get('/products')
        .expect(200);
      assertCatalog(anonymousResponse.body);

      const sellerResponse = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${signToken('seller')}`)
        .expect(200);
      assertCatalog(sellerResponse.body);

      const buyerResponse = await request(app.getHttpServer())
        .get('/products')
        .set('Authorization', `Bearer ${signToken('buyer')}`)
        .expect(200);
      assertCatalog(buyerResponse.body);
    });
  });

  describe('GET /products/seller/:sellerId', () => {
    it('returns exactly the active products of the given seller, excluding inactive ones and other sellers, regardless of auth', async () => {
      const sellerA = randomUUID();
      const sellerB = randomUUID();

      const productA1 = await createProduct({ sellerId: sellerA });
      const productA2 = await createProduct({ sellerId: sellerA });
      const inactiveA = await createProduct({
        sellerId: sellerA,
        isActive: false,
      });
      await createProduct({ sellerId: sellerB });

      const assertSellerCatalog = (body: unknown) => {
        const list = body as Array<{ id: string }>;
        const ids = list.map((p) => p.id).sort();
        expect(ids).toEqual([productA1.id, productA2.id].sort());
        expect(ids).not.toContain(inactiveA.id);
      };

      const anonymousResponse = await request(app.getHttpServer())
        .get(`/products/seller/${sellerA}`)
        .expect(200);
      assertSellerCatalog(anonymousResponse.body);

      const authResponse = await request(app.getHttpServer())
        .get(`/products/seller/${sellerA}`)
        .set('Authorization', `Bearer ${signToken('buyer')}`)
        .expect(200);
      assertSellerCatalog(authResponse.body);
    });

    it('returns an empty array (never 404) when the seller has no active products', async () => {
      const response = await request(app.getHttpServer())
        .get(`/products/seller/${randomUUID()}`)
        .expect(200);

      expect(response.body).toEqual([]);
    });

    it('returns 400 when sellerId is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get('/products/seller/not-a-uuid')
        .expect(400);
    });
  });

  describe('GET /products/:id', () => {
    it('returns the full product data for an active product, without requiring auth', async () => {
      const sellerId = randomUUID();
      const product = await createProduct({ sellerId });

      const response = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: product.id,
        name: product.name,
        description: product.description,
        sellerId,
        isActive: true,
      });
      expect(response.body).toHaveProperty('createdAt');
      expect(response.body).toHaveProperty('updatedAt');
    });

    it('returns the product even when it is inactive (detail is not filtered by isActive)', async () => {
      const sellerId = randomUUID();
      const product = await createProduct({ sellerId, isActive: false });

      const response = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .set('Authorization', `Bearer ${signToken('seller')}`)
        .expect(200);

      expect(response.body).toMatchObject({ id: product.id, isActive: false });
    });

    it('returns 404 when no product exists with the given id', async () => {
      await request(app.getHttpServer())
        .get('/products/11111111-1111-4111-8111-111111111111')
        .expect(404);
    });

    it('returns 400 when id is not a valid UUID', async () => {
      await request(app.getHttpServer())
        .get('/products/not-a-uuid')
        .expect(400);
    });
  });

  describe('route precedence: seller/:sellerId vs :id', () => {
    it('never treats the "seller" segment as an :id value, regardless of call order', async () => {
      const sellerId = randomUUID();
      const product = await createProduct({ sellerId });

      const idFirstResponse = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);
      expect(Array.isArray(idFirstResponse.body)).toBe(false);

      const sellerFirstResponse = await request(app.getHttpServer())
        .get(`/products/seller/${sellerId}`)
        .expect(200);
      expect(Array.isArray(sellerFirstResponse.body)).toBe(true);

      // Repeat in reverse order to confirm routing does not depend on call sequence.
      const sellerAgainResponse = await request(app.getHttpServer())
        .get(`/products/seller/${sellerId}`)
        .expect(200);
      expect(Array.isArray(sellerAgainResponse.body)).toBe(true);

      const idAgainResponse = await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);
      expect(Array.isArray(idAgainResponse.body)).toBe(false);
    });
  });

  describe('read-only guarantee', () => {
    it('does not modify any product data when hitting the query endpoints', async () => {
      const sellerId = randomUUID();
      const product = await createProduct({ sellerId });

      const before = await productRepository.findOne({
        where: { id: product.id },
      });

      await request(app.getHttpServer()).get('/products').expect(200);
      await request(app.getHttpServer())
        .get(`/products/seller/${sellerId}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/products/${product.id}`)
        .expect(200);

      const after = await productRepository.findOne({
        where: { id: product.id },
      });

      expect(after).toEqual(before);
    });
  });
});
