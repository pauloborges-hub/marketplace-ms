import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FakePaymentGatewayService } from './fake-payment-gateway.service';
import { Payment } from './entities/payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Payment])],
  controllers: [PaymentsController],
  providers: [PaymentsService, FakePaymentGatewayService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
