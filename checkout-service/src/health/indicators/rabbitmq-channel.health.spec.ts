import { Test, TestingModule } from '@nestjs/testing';
import { HealthIndicatorService } from '@nestjs/terminus';

import { RabbitmqService } from '../../events/rabbitmq/rabbitmq.service';
import { RabbitmqChannelHealthIndicator } from './rabbitmq-channel.health';

describe('RabbitmqChannelHealthIndicator', () => {
  let indicator: RabbitmqChannelHealthIndicator;
  const getChannel = jest.fn();

  beforeEach(async () => {
    getChannel.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitmqChannelHealthIndicator,
        HealthIndicatorService,
        { provide: RabbitmqService, useValue: { getChannel } },
      ],
    }).compile();

    indicator = module.get(RabbitmqChannelHealthIndicator);
  });

  it('reports up when the service holds an AMQP channel', () => {
    getChannel.mockReturnValue({});

    expect(indicator.isHealthy('rabbitmq-channel')).toEqual({
      'rabbitmq-channel': { status: 'up' },
    });
  });

  it('reports down when the service has no AMQP channel', () => {
    getChannel.mockReturnValue(undefined);

    expect(indicator.isHealthy('rabbitmq-channel')).toEqual({
      'rabbitmq-channel': {
        status: 'down',
        message: 'No active AMQP channel: messages are being discarded',
      },
    });
  });

  it('does not touch the broker', () => {
    getChannel.mockReturnValue({});

    indicator.isHealthy('rabbitmq-channel');

    expect(getChannel).toHaveBeenCalledTimes(1);
  });
});
