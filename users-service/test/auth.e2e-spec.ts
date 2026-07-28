import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { User, UserStatus } from '../src/users/entities/user.entity';
import { createTestApp } from './utils/create-test-app';

// Cobre as regras de negócio de POST /auth/register e POST /auth/login.
// A proteção de rota em si (quem exige token) fica em route-protection.e2e-spec.
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;

  const validRegistration = {
    email: 'auth-e2e@example.com',
    password: 'secret1',
    firstName: 'Auth',
    lastName: 'E2e',
    role: 'buyer',
  };

  const register = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/register').send(body);

  const login = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/auth/login').send(body);

  beforeEach(async () => {
    app = await createTestApp();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('cria o usuário, responde 201 e nunca devolve o hash da senha', async () => {
      const response = await register(validRegistration).expect(201);

      expect(response.body).toMatchObject({
        email: validRegistration.email,
        firstName: validRegistration.firstName,
        lastName: validRegistration.lastName,
        role: 'buyer',
        status: 'active',
      });
      expect(response.body).toHaveProperty('id');
      expect(response.body).not.toHaveProperty('password');
    });

    it('persiste a senha com hash, não em texto puro', async () => {
      await register(validRegistration).expect(201);

      const userRepository = app.get<Repository<User>>(
        getRepositoryToken(User),
      );
      const saved = await userRepository.findOne({
        where: { email: validRegistration.email },
      });

      expect(saved).not.toBeNull();
      expect(saved?.password).not.toBe(validRegistration.password);
      expect(saved?.password).toMatch(/^\$2[aby]\$/); // formato bcrypt
    });

    it('normaliza o e-mail para lowercase antes de gravar', async () => {
      const response = await register({
        ...validRegistration,
        email: 'Auth-Normalized@Example.COM',
      }).expect(201);

      expect(response.body).toMatchObject({
        email: 'auth-normalized@example.com',
      });
    });

    // O AuthService faz `trim()` no e-mail, mas o @IsEmail() do RegisterDto roda
    // antes e já barra espaços nas pontas — então o trim nunca chega a ser
    // observável pela API. Documentado aqui para o comportamento não regredir
    // silenciosamente caso a validação mude.
    it('rejeita com 400 quando o e-mail vem com espaços nas pontas', async () => {
      await register({
        ...validRegistration,
        email: `  ${validRegistration.email}  `,
      }).expect(400);
    });

    it('rejeita com 409 quando o e-mail já está cadastrado', async () => {
      await register(validRegistration).expect(201);

      await register(validRegistration).expect(409);
    });

    it('trata o e-mail duplicado independentemente da caixa', async () => {
      await register(validRegistration).expect(201);

      await register({
        ...validRegistration,
        email: validRegistration.email.toUpperCase(),
      }).expect(409);
    });

    it.each([
      ['e-mail em formato inválido', { email: 'not-an-email' }],
      ['senha com menos de 6 caracteres', { password: '123' }],
      ['role fora do enum', { role: 'admin' }],
      ['firstName vazio', { firstName: '' }],
    ])('rejeita com 400 quando o payload tem %s', async (_label, override) => {
      await register({ ...validRegistration, ...override }).expect(400);
    });

    it('rejeita com 400 quando o payload traz uma propriedade desconhecida', async () => {
      await register({ ...validRegistration, isAdmin: true }).expect(400);
    });
  });

  describe('POST /auth/login', () => {
    beforeEach(async () => {
      await register(validRegistration).expect(201);
    });

    it('responde 200 com o usuário (sem senha) e um JWT assinado com as claims esperadas', async () => {
      const response = await login({
        email: validRegistration.email,
        password: validRegistration.password,
      }).expect(200);

      const body = response.body as {
        token: string;
        user: { id: string; email: string };
      };

      expect(body.user).toMatchObject({ email: validRegistration.email });
      expect(body.user).not.toHaveProperty('password');
      expect(typeof body.token).toBe('string');

      const payload = new JwtService({
        secret: process.env.JWT_SECRET,
      }).verify<{ sub: string; email: string; role: string }>(body.token);

      expect(payload).toMatchObject({
        sub: body.user.id,
        email: validRegistration.email,
        role: 'buyer',
      });
    });

    it('aceita o login com o e-mail em outra caixa', async () => {
      await login({
        email: validRegistration.email.toUpperCase(),
        password: validRegistration.password,
      }).expect(200);
    });

    it('rejeita com 401 quando a senha está errada', async () => {
      await login({
        email: validRegistration.email,
        password: 'wrong-password',
      }).expect(401);
    });

    it('rejeita com 401 quando o e-mail não existe', async () => {
      await login({
        email: 'ghost@example.com',
        password: validRegistration.password,
      }).expect(401);
    });

    it('não revela se o e-mail existe: mesma mensagem para senha errada e usuário inexistente', async () => {
      const wrongPassword = await login({
        email: validRegistration.email,
        password: 'wrong-password',
      }).expect(401);

      const unknownEmail = await login({
        email: 'ghost@example.com',
        password: validRegistration.password,
      }).expect(401);

      expect((wrongPassword.body as { message: string }).message).toBe(
        (unknownEmail.body as { message: string }).message,
      );
    });

    it('rejeita com 401 quando a conta não está ativa, mesmo com a senha correta', async () => {
      const userRepository = app.get<Repository<User>>(
        getRepositoryToken(User),
      );
      await userRepository.update(
        { email: validRegistration.email },
        { status: UserStatus.INACTIVE },
      );

      await login({
        email: validRegistration.email,
        password: validRegistration.password,
      }).expect(401);
    });

    it('rejeita com 400 quando o payload é inválido', async () => {
      await login({ email: 'not-an-email', password: '123' }).expect(400);
    });
  });

  describe('GET /auth/validate-token', () => {
    it('devolve as claims do usuário autenticado a partir do token emitido no login', async () => {
      await register(validRegistration).expect(201);

      const loginResponse = await login({
        email: validRegistration.email,
        password: validRegistration.password,
      }).expect(200);

      const { token, user } = loginResponse.body as {
        token: string;
        user: { id: string };
      };

      const response = await request(app.getHttpServer())
        .get('/auth/validate-token')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toEqual({
        userId: user.id,
        email: validRegistration.email,
        role: 'buyer',
      });
    });

    it('rejeita com 401 quando nenhum token é enviado', async () => {
      await request(app.getHttpServer())
        .get('/auth/validate-token')
        .expect(401);
    });
  });
});
