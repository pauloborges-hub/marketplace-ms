import { Test, TestingModule } from '@nestjs/testing';

import { ProxyService } from '../proxy/service/proxy.service';
import { PaymentsProxyController } from './payments.controller';

describe('PaymentsProxyController', () => {
  let controller: PaymentsProxyController;
  let proxyService: { proxyRequest: jest.Mock };

  beforeEach(async () => {
    proxyService = { proxyRequest: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsProxyController],
      providers: [{ provide: ProxyService, useValue: proxyService }],
    }).compile();

    controller = module.get<PaymentsProxyController>(PaymentsProxyController);
  });

  it('proxies GET /payments/:orderId with authorization and user', async () => {
    const user = { userId: 'user-1', email: 'user@example.com', role: 'buyer' };

    await controller.getByOrderId('order-123', 'Bearer token', user);

    expect(proxyService.proxyRequest).toHaveBeenCalledWith(
      'payments',
      'GET',
      '/payments/order-123',
      undefined,
      { authorization: 'Bearer token' },
      user,
    );
  });
});
