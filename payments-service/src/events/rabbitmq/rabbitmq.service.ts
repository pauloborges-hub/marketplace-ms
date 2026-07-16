import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RabbitmqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitmqService.name);
  private connection: amqp.ChannelModel;
  private channel: amqp.Channel;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async waitForConnection(maxAttempts = 10, delayMs = 500): Promise<boolean> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (this.channel) {
        return true;
      }

      this.logger.log(
        `⏳ Waiting for RabbitMQ connection... (attempt ${attempt}/${maxAttempts})`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return false;
  }

  private async connect() {
    try {
      const rabbitmqUrl = this.configService.get<string>(
        'RABBITMQ_URL',
        'amqp://admin:admin@localhost:5672',
      );

      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      this.logger.log('✅ Connected to RabbitMQ successfully');

      // Event listener para monitorar a conexão
      this.connection.on('error', (err) => {
        this.logger.error('❌ RabbitMQ connection error:', err);
      });

      this.connection.on('close', () => {
        this.logger.warn('⚠️ RabbitMQ connection closed');
      });

      this.connection.on('blocked', (reason) => {
        this.logger.warn('⚠️ RabbitMQ connection blocked:', reason);
      });

      this.connection.on('unblocked', () => {
        this.logger.log('✅ RabbitMQ connection unblocked');
      });
    } catch (error) {
      this.logger.warn(
        '⚠️ Failed to connect to RabbitMQ, cotinuing wihout message queue:',
        error.message || error,
      );
    }
  }

  private async disconnect() {
    try {
      if (this.channel) {
        await this.channel.close();
        this.logger.log('✅ RabbitMQ channel closed');
      }

      if (this.connection) {
        await this.connection.close();
        this.logger.log('✅ Disconnected from RabbitMQ');
      }
    } catch (error) {
      this.logger.error('❌ Error disconnecting from RabbitMQ:', error);
    }
  }

  getChannel(): amqp.Channel {
    return this.channel;
  }

  getConnection(): amqp.ChannelModel {
    return this.connection;
  }

  async publishMessage(
    exchange: string,
    routingKey: string,
    message: any,
  ): Promise<void> {
    try {
      if (!this.channel) {
        this.logger.warn(
          '⚠️ RabbitMQ channel not available, skipping message publish',
        );

        return;
      }

      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      const messageBuffer = Buffer.from(JSON.stringify(message));

      const published = this.channel.publish(
        exchange,
        routingKey,
        messageBuffer,
        {
          persistent: true,
          timestamp: Date.now(),
          contentType: 'application/json',
        },
      );

      this.logger.log(`✅ Message published to ${exchange}:${routingKey}`);
      this.logger.debug(`Message content: ${JSON.stringify(message)}`);
      if (!published) {
        throw new Error('Failed to publish message to RabbitMQ');
      }
    } catch (error) {
      this.logger.error('❌ Error publishing message to RabbitMQ:', error);
    }
  }

  async subscribeToQueue(
    queueName: string,
    exchange: string,
    routingKey: string,
    callback: (message: unknown) => Promise<void>,
    options: {
      maxRetries?: number;
      retryDelayMs?: number;
    } = {},
  ): Promise<void> {
    const maxRetries = options.maxRetries ?? 3;
    const retryDelayMs = options.retryDelayMs ?? 30000;

    try {
      if (!this.channel) {
        throw new Error('RabbitMQ channel not available');
      }

      await this.channel.assertExchange(exchange, 'topic', {
        durable: true,
      });

      const retryExchange = `${exchange}.retry.dlx`;
      await this.channel.assertExchange(retryExchange, 'topic', {
        durable: true,
      });

      const dlxExchange = `${exchange}.dlx`;
      await this.channel.assertExchange(dlxExchange, 'topic', {
        durable: true,
      });

      // DLQ
      const dlqName = `${queueName}.dlq`;
      await this.channel.assertQueue(dlqName, {
        durable: true,
        arguments: {
          'x-message-ttl': 604800000, // 7 dias para análise
        },
      });

      const routingKeyDlq = `${routingKey}.dlq`;
      await this.channel.bindQueue(dlqName, dlxExchange, routingKeyDlq);

      // Retry
      const routingKeyRetry = `${queueName}.retry`;

      const retryQueueName = `${queueName}.retry`;
      await this.channel.assertQueue(retryQueueName, {
        durable: true,
        arguments: {
          'x-message-ttl': retryDelayMs,
          'x-dead-letter-exchange': exchange,
          'x-dead-letter-routing-key': routingKey,
        },
      });

      await this.channel.bindQueue(
        retryQueueName,
        retryExchange,
        routingKeyRetry,
      );

      // Main queue
      const queue = await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-message-ttl': 86400000,
          'x-max-length': 10000,
          'x-dead-letter-exchange': retryExchange,
          'x-dead-letter-routing-key': routingKeyRetry,
        },
      });

      await this.channel.bindQueue(queue.queue, exchange, routingKey);

      await this.channel.prefetch(1);

      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      await this.channel.consume(queue.queue, async (msg) => {
        if (msg) {
          try {
            const message: unknown = JSON.parse(msg.content.toString());
            this.logger.log(`📨 Message received from queue: ${queueName}`);
            this.logger.debug(`Message content: ${JSON.stringify(message)}`);

            const retryCount = this.getRetryCount(msg);

            this.logger.log(
              `📨 Message received (attempt ${retryCount + 1}/${maxRetries + 1})`,
            );

            await callback(message);

            this.channel.ack(msg);

            this.logger.log(
              `✅ Message processed succesfully from queue: ${queueName}`,
            );
          } catch (error) {
            const retryCount = this.getRetryCount(msg);
            if (retryCount < maxRetries) {
              this.logger.warn(
                `⚠️ Processing failed (attempt ${retryCount + 1}/${maxRetries + 1}). ` +
                  `Retrying in ${retryDelayMs / 1000}s...`,
              );

              this.channel.nack(msg, false, false);
            } else {
              this.logger.error(
                `💀 Max retries (${maxRetries}) exceeded. Sending to DLQ.`,
              );

              // Publica diretamente na DLQ (bypass da retry queue)
              this.channel.publish(
                dlxExchange,
                `${routingKey}.dlq`,
                msg.content,
                { persistent: true, headers: msg.properties.headers },
              );

              this.channel.ack(msg); // Remove da fila principal
            }
          }
        }
      });

      this.logger.log(`✅ Subscribed to queue: ${queueName}`);
      this.logger.log(
        `🔄 Retry queue: ${retryQueueName} (${retryDelayMs}ms delay)`,
      );
    } catch (error) {
      this.logger.error(`❌ Error subscribing to queue ${queueName}:`, error);
    }
  }

  /**
   * Extrai o número de retries do header x-death
   * O RabbitMQ adiciona esse header automaticamente
   */
  private getRetryCount(msg: amqp.ConsumeMessage): number {
    const xDeath = msg.properties.headers?.['x-death'] as
      | Array<{
          count: number;
          queue: string;
        }>
      | undefined;

    if (!xDeath || xDeath.length === 0) {
      return 0;
    }

    // Soma todas as vezes que passou pela fila principal
    return xDeath
      .filter((death) => !death.queue.endsWith('.retry'))
      .reduce((sum, death) => sum + (death.count || 0), 0);
  }
}
