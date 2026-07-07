import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './utils/create-test-app';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    app = await createTestApp();
  });

  it('/ (GET) returns Hello World! for an authenticated user', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'app-e2e@example.com',
      password: 'secret1',
      firstName: 'App',
      lastName: 'E2e',
      role: 'buyer',
    });

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'app-e2e@example.com', password: 'secret1' });

    const { token } = loginResponse.body as { token: string };

    return request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });
});
