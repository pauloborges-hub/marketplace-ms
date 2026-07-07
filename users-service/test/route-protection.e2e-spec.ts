import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

describe('Route protection (e2e)', () => {
  let app: INestApplication<App>;

  const registerDto = {
    email: 'route-protection-e2e@example.com',
    password: 'secret1',
    firstName: 'Route',
    lastName: 'Protection',
    role: 'buyer',
  };

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

  afterEach(async () => {
    await app.close();
  });

  it('allows POST /auth/register without an Authorization header', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registerDto)
      .expect((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  it('allows POST /auth/login without an Authorization header', async () => {
    await request(app.getHttpServer()).post('/auth/register').send(registerDto);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registerDto.email, password: registerDto.password })
      .expect((res) => {
        expect(res.status).not.toBe(401);
      });
  });

  it('rejects a route with no @Public() marking when no Authorization header is sent', async () => {
    await request(app.getHttpServer()).get('/').expect(401);
  });

  it('rejects a route with no @Public() marking when the Authorization header is not in the Bearer <token> format', async () => {
    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', 'Basic abc123')
      .expect(401);
  });

  it('rejects a route with no @Public() marking when the token is expired', async () => {
    const jwtService = new JwtService({ secret: process.env.JWT_SECRET });
    const expiredToken = jwtService.sign(
      { sub: 'uuid', email: registerDto.email, role: 'buyer' },
      { expiresIn: '-10s' },
    );

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${expiredToken}`)
      .expect(401);
  });

  it('rejects a route with no @Public() marking when the token is signed with a different secret', async () => {
    const jwtService = new JwtService({ secret: 'a-different-secret' });
    const tokenSignedWithWrongSecret = jwtService.sign({
      sub: 'uuid',
      email: registerDto.email,
      role: 'buyer',
    });

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${tokenSignedWithWrongSecret}`)
      .expect(401);
  });

  it('rejects a route with no @Public() marking when the token is malformed', async () => {
    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', 'Bearer not-a-real-jwt')
      .expect(401);
  });

  it('allows a route with no @Public() marking when a valid token issued by POST /auth/login is sent', async () => {
    await request(app.getHttpServer()).post('/auth/register').send(registerDto);

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registerDto.email, password: registerDto.password });

    const { token } = loginResponse.body as { token: string };

    await request(app.getHttpServer())
      .get('/')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)
      .expect('Hello World!');
  });
});
