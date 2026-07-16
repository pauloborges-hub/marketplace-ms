import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';

import { Payment } from './entities/payment.entity';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':orderId')
  findByOrderId(
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<Payment> {
    return this.paymentsService.findByOrderId(orderId);
  }
}
