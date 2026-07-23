import { ConfigService } from '@nestjs/config';
import { MetricsService } from '../../metrics/metrics.service';
import { RabbitmqService } from './rabbitmq.service';

describe('RabbitmqService.publishMessage — métrica de negócio', () => {
  let service: RabbitmqService;
  let metrics: { recordMessagePublished: jest.Mock };
  let channel: { assertExchange: jest.Mock; publish: jest.Mock };

  const EXCHANGE = 'payments';
  const ROUTING_KEY = 'payment.order';

  beforeEach(() => {
    metrics = { recordMessagePublished: jest.fn() };
    service = new RabbitmqService(
      new ConfigService(),
      metrics as unknown as MetricsService,
    );
    channel = {
      assertExchange: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockReturnValue(true),
    };
  });

  const setChannel = (ch: unknown) => {
    (service as unknown as { channel: unknown }).channel = ch;
  };

  it('CA-6 — publicação confirmada registra a métrica com queue=routingKey', async () => {
    setChannel(channel);

    await service.publishMessage(EXCHANGE, ROUTING_KEY, { foo: 'bar' });

    expect(channel.publish).toHaveBeenCalledTimes(1);
    expect(metrics.recordMessagePublished).toHaveBeenCalledTimes(1);
    expect(metrics.recordMessagePublished).toHaveBeenCalledWith(ROUTING_KEY);
  });

  it('CA-7 — canal indisponível não registra a métrica', async () => {
    setChannel(undefined);

    await service.publishMessage(EXCHANGE, ROUTING_KEY, { foo: 'bar' });

    expect(metrics.recordMessagePublished).not.toHaveBeenCalled();
  });

  it('CA-7 — publish com backpressure (retorna false) não registra a métrica', async () => {
    channel.publish.mockReturnValue(false);
    setChannel(channel);

    await service.publishMessage(EXCHANGE, ROUTING_KEY, { foo: 'bar' });

    expect(metrics.recordMessagePublished).not.toHaveBeenCalled();
  });

  it('CA-7 — erro durante o publish não registra a métrica', async () => {
    channel.publish.mockImplementation(() => {
      throw new Error('broker down');
    });
    setChannel(channel);

    await service.publishMessage(EXCHANGE, ROUTING_KEY, { foo: 'bar' });

    expect(metrics.recordMessagePublished).not.toHaveBeenCalled();
  });
});
