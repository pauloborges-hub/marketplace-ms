import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
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
