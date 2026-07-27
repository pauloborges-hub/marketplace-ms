import { randomUUID } from 'crypto';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';

import { databaseConfig } from '../src/config/database.config';
import { MetricsModule } from '../src/metrics/metrics.module';
import {
  Payment,
  PaymentStatus,
} from '../src/payments/entities/payment.entity';
import { PaymentsModule } from '../src/payments/payments.module';

describe('Payments (e2e)', () => {
  let app: INestApplication<App>;
  let repository: Repository<Payment>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot(databaseConfig),
        MetricsModule,
        PaymentsModule,
      ],
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

    repository = moduleFixture.get<Repository<Payment>>(
      getRepositoryToken(Payment),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('CA9 — GET /payments/:orderId retorna 200 com os dados do pagamento existente', async () => {
    const orderId = randomUUID();
    await repository.save(
      repository.create({
        orderId,
        userId: randomUUID(),
        amount: 150.5,
        paymentMethod: 'pix',
        status: PaymentStatus.APPROVED,
        transactionId: 'txn_e2e',
        rejectionReason: null,
        processedAt: new Date(),
      }),
    );

    const response = await request(app.getHttpServer())
      .get(`/payments/${orderId}`)
      .expect(200);

    expect(response.body).toMatchObject({
      orderId,
      status: PaymentStatus.APPROVED,
      amount: 150.5,
      paymentMethod: 'pix',
      transactionId: 'txn_e2e',
      rejectionReason: null,
    });
    expect(response.body.processedAt).toBeDefined();

    await repository.delete({ orderId });
  });

  it('CA10 — GET /payments/:orderId retorna 404 quando não há pagamento', () => {
    return request(app.getHttpServer())
      .get(`/payments/${randomUUID()}`)
      .expect(404);
  });
});
