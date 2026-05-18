import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "'data:'", "'https:'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }),
  );

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || ['*'];

      if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
    ],
    credentials: true,
    maxAge: 84400, // 24 hours
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Marketplace API Gateway')
    .setDescription(
      `
      API Gateway para o sistema de Marketplace com microserviços

      Serviços Disponíveis:
      - Users Service: Autenticação e gestão de usuários
      - Products Service: Catálogo e gestão de produtos
      - Checkout Service: Carrinho e processamento de pedidos
      - Payments Service: Processamento de pagamentos

      Autenticação:
      - Use JWT Bearer token para rotas protegidas
      - Use Session token para validação de sessão
      `,
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'x-session-token',
        in: 'header',
        description: 'Session token for user validation',
      },
      'session-auth',
    )
    .addTag('Authentication', 'Endpoints para autenticação e autorização')
    .addTag('Users', 'Endpoints para gestão de usuários')
    .addTag('Products', 'Endpoints para catálogo de produtos')
    .addTag('Checkout', 'Endpoints para carrinho e pedidos')
    .addTag('Payments', 'Endpoints para processamento de pagamentos')
    .addTag('Health', 'Endpoints para monitoramento de saúde')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    swaggerOptions: {},
    customSiteTitle: 'Marketplace API Gateway Documentation',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info .title { color: #3b82f6 }
    `,
  });

  const port = process.env.PORT ?? 3005;
  await app.listen(port);

  console.log(`API Gateway on port ${port}`);
  console.log(`Swagger documentation <http://localhost>:${port}/api`);
}

bootstrap();
