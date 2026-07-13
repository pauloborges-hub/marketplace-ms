import { Body, Controller, Get, Post } from '@nestjs/common';

import { AppService } from './app.service';
import { Public } from './auth/decorators/public.decorator';
import { PaymentOrderMessage } from './events/payment-queue.interface';
import { PaymentQueueService } from './events/payment-queue/payment-queue.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly paymentQueueService: PaymentQueueService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  getHealth(): { status: string; service: string } {
    return this.appService.getHealth();
  }

  @Post('test/send-message')
  async testSendMessage(@Body() body?: Partial<PaymentOrderMessage>) {
    const testMessage: PaymentOrderMessage = {
      orderId: body?.orderId || `test-order-${Date.now()}`,
      userId: body?.userId || 'test-user-123',
      amount: body?.amount || 199.99,
      items: body?.items || [
        {
          productId: 'product-1',
          quantity: 2,
          price: 99.99,
        },
      ],
      paymentMethod: body?.paymentMethod || 'credit_card',
      description: body?.description || 'Mensagem de teste',
      createdAt: new Date(),
    };

    await this.paymentQueueService.publishPaymentOrder(testMessage);

    return {
      success: true,
      message: 'Mensagem enviada para o RabbitMQ',
      data: testMessage,
    };
  }
}
