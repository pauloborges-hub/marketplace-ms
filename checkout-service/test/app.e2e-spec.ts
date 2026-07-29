import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { createTestApp } from './utils/create-test-app';
import { signToken } from './utils/sign-token';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('/ (GET) is protected and returns 401 without a token', () => {
    return request(app.getHttpServer()).get('/').expect(401);
  });

  it('/ (GET) returns Hello World! for an authenticated user', () => {
    return request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${signToken('buyer')}`)
      .expect(200)
      .expect('Hello World!');
  });
});
