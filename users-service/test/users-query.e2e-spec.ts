import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../src/users/entities/user.entity';
import { createTestApp } from './utils/create-test-app';

describe('Users query endpoints (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  async function registerAndLogin(overrides: {
    email: string;
    role: 'seller' | 'buyer';
  }) {
    const dto = {
      email: overrides.email,
      password: 'secret1',
      firstName: 'Users',
      lastName: 'Query',
      role: overrides.role,
    };

    await request(app.getHttpServer()).post('/auth/register').send(dto);

    // The test database persists across runs (no reset/truncate hook), so a
    // user left INACTIVE by a previous run of the "sellers" test below must
    // be reactivated here, otherwise this helper's login would fail.
    const userRepository = app.get<Repository<User>>(getRepositoryToken(User));
    await userRepository.update(
      { email: dto.email },
      { status: UserStatus.ACTIVE },
    );

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: dto.email, password: dto.password });

    const { token, user } = loginResponse.body as {
      token: string;
      user: { id: string };
    };

    return { token, id: user.id, dto };
  }

  describe('GET /users/profile', () => {
    const email = 'users-query-profile@example.com';

    it('returns the authenticated user, fetched from the database, without the password', async () => {
      const { token, dto } = await registerAndLogin({ email, role: 'buyer' });

      const response = await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        role: dto.role,
        status: 'active',
      });
      expect(response.body).not.toHaveProperty('password');
    });

    it('rejects the request with 401 when no Authorization header is sent', async () => {
      await request(app.getHttpServer()).get('/users/profile').expect(401);
    });

    it('rejects the request with 401 when the token is malformed', async () => {
      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', 'Bearer not-a-real-jwt')
        .expect(401);
    });

    it('returns 404 when the token is valid but the referenced user no longer exists', async () => {
      const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
      const tokenForMissingUser = jwtService.sign({
        sub: '11111111-1111-4111-8111-111111111111',
        email: 'ghost@example.com',
        role: 'buyer',
      });

      await request(app.getHttpServer())
        .get('/users/profile')
        .set('Authorization', `Bearer ${tokenForMissingUser}`)
        .expect(404);
    });
  });

  describe('GET /users/sellers', () => {
    const activeSellerEmail = 'users-query-seller-active@example.com';
    const inactiveSellerEmail = 'users-query-seller-inactive@example.com';
    const buyerEmail = 'users-query-buyer@example.com';

    it('returns only sellers with active status, without the password field', async () => {
      const activeSeller = await registerAndLogin({
        email: activeSellerEmail,
        role: 'seller',
      });
      const inactiveSeller = await registerAndLogin({
        email: inactiveSellerEmail,
        role: 'seller',
      });
      const buyer = await registerAndLogin({
        email: buyerEmail,
        role: 'buyer',
      });

      const userRepository = app.get<Repository<User>>(
        getRepositoryToken(User),
      );
      await userRepository.update(
        { id: inactiveSeller.id },
        { status: UserStatus.INACTIVE },
      );

      const response = await request(app.getHttpServer())
        .get('/users/sellers')
        .set('Authorization', `Bearer ${activeSeller.token}`)
        .expect(200);

      const body = response.body as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);

      const activeSellerEntry = body.find(
        (entry) => entry.email === activeSellerEmail,
      );
      const inactiveSellerEntry = body.find(
        (entry) => entry.email === inactiveSellerEmail,
      );
      const buyerEntry = body.find((entry) => entry.email === buyerEmail);

      expect(activeSellerEntry).toBeDefined();
      expect(activeSellerEntry).not.toHaveProperty('password');
      expect(inactiveSellerEntry).toBeUndefined();
      expect(buyerEntry).toBeUndefined();
      expect(buyer.token).toBeDefined();
    });

    it('rejects the request with 401 when no Authorization header is sent', async () => {
      await request(app.getHttpServer()).get('/users/sellers').expect(401);
    });
  });

  describe('GET /users/:id', () => {
    it('returns the user matching the given id, regardless of who is authenticated', async () => {
      const userA = await registerAndLogin({
        email: 'users-query-id-a@example.com',
        role: 'buyer',
      });
      const userB = await registerAndLogin({
        email: 'users-query-id-b@example.com',
        role: 'buyer',
      });

      const response = await request(app.getHttpServer())
        .get(`/users/${userA.id}`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(200);

      expect(response.body).toMatchObject({
        id: userA.id,
        email: userA.dto.email,
      });
      expect(response.body).not.toHaveProperty('password');
    });

    it('returns 404 when the id is a valid UUID but no user exists with it', async () => {
      const { token } = await registerAndLogin({
        email: 'users-query-id-requester@example.com',
        role: 'buyer',
      });

      await request(app.getHttpServer())
        .get('/users/11111111-1111-4111-8111-111111111111')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('returns 400 when the id is not a valid UUID', async () => {
      const { token } = await registerAndLogin({
        email: 'users-query-id-invalid@example.com',
        role: 'buyer',
      });

      await request(app.getHttpServer())
        .get('/users/abc123')
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
    });

    it('rejects the request with 401 when no Authorization header is sent', async () => {
      await request(app.getHttpServer())
        .get('/users/11111111-1111-4111-8111-111111111111')
        .expect(401);
    });
  });
});
