import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { Product } from '../src/products/entities/product.entity';
import { createTestApp } from './utils/create-test-app';

// Each test signs a token for a freshly generated seller/buyer id, so every
// run creates its own isolated rows in the shared, never-reset test database
// — no run ever reads or mutates a row left behind by a previous run.
function signToken(role: 'seller' | 'buyer', sub: string = randomUUID()) {
  const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
  return jwtService.sign({ sub, email: `${role}-${sub}@example.com`, role });
}

const validProductDto = {
  name: 'Wireless Mouse',
  description: 'Ergonomic wireless mouse',
  price: 99.9,
  stock: 10,
};

describe('Product creation (e2e)', () => {
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

  it('creates a product for an authenticated seller, deriving sellerId from the token and forcing isActive true', async () => {
    const sellerId = randomUUID();
    const token = signToken('seller', sellerId);

    const response = await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(validProductDto)
      .expect(201);

    expect(response.body).toMatchObject({
      name: validProductDto.name,
      description: validProductDto.description,
      price: validProductDto.price,
      stock: validProductDto.stock,
      sellerId,
      isActive: true,
    });
    const { price } = response.body as { price: number };
    expect(typeof price).toBe('number');

    const stored = await productRepository.findOne({ where: { sellerId } });
    expect(stored).not.toBeNull();
    expect(stored?.isActive).toBe(true);
  });

  it('ignores a client-supplied sellerId/isActive: whitelist rejects the request with 400 and nothing is created', async () => {
    const sellerId = randomUUID();
    const impersonatedSellerId = randomUUID();
    const token = signToken('seller', sellerId);

    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        ...validProductDto,
        sellerId: impersonatedSellerId,
        isActive: false,
      })
      .expect(400);

    expect(await productRepository.count({ where: { sellerId } })).toBe(0);
    expect(
      await productRepository.count({
        where: { sellerId: impersonatedSellerId },
      }),
    ).toBe(0);
  });

  it('rejects with 401 when no Authorization header is sent', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .send(validProductDto)
      .expect(401);
  });

  it('rejects with 401 when the token is malformed', async () => {
    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .send(validProductDto)
      .expect(401);
  });

  it('rejects with 403 when the authenticated user is a buyer, and creates nothing', async () => {
    const buyerId = randomUUID();
    const token = signToken('buyer', buyerId);

    await request(app.getHttpServer())
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(validProductDto)
      .expect(403);

    expect(
      await productRepository.count({ where: { sellerId: buyerId } }),
    ).toBe(0);
  });

  describe('validation of the request body', () => {
    const sellerId = randomUUID();
    const token = signToken('seller', sellerId);

    const cases: Array<[string, Record<string, unknown>]> = [
      ['name is missing', { ...validProductDto, name: undefined }],
      [
        'name is longer than 255 characters',
        { ...validProductDto, name: 'a'.repeat(256) },
      ],
      [
        'description is missing',
        { ...validProductDto, description: undefined },
      ],
      ['price is missing', { ...validProductDto, price: undefined }],
      ['price is below the 0.01 minimum', { ...validProductDto, price: 0 }],
      [
        'price has more than 2 decimal places',
        { ...validProductDto, price: 10.999 },
      ],
      ['stock is missing', { ...validProductDto, stock: undefined }],
      ['stock is negative', { ...validProductDto, stock: -1 }],
      ['stock is not an integer', { ...validProductDto, stock: 1.5 }],
    ];

    it.each(cases)('returns 400 when %s', async (_description, body) => {
      await request(app.getHttpServer())
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(400);

      expect(await productRepository.count({ where: { sellerId } })).toBe(0);
    });
  });
});
