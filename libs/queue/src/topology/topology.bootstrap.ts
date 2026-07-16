import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Channel } from 'amqplib';
import { RMQConnection } from '../connection/rmq.connection';
import { RMQ_MODULE_OPTIONS } from '../queue.constants';
import type { QueueModuleOptions, RmqQueueDefinition } from '../queue.types';
import { RetryTopologyBuilder } from '../retry/retry-topology.builder';

@Injectable()
export class TopologyBootstrap implements OnModuleInit {
  private readonly logger = new Logger(TopologyBootstrap.name);

  private bootstrapPromise: Promise<void> | undefined;

  constructor(
    private readonly connection: RMQConnection,

    @Inject(RMQ_MODULE_OPTIONS)
    private readonly options: QueueModuleOptions,
  ) {}

  onModuleInit(): Promise<void> {
    this.bootstrapPromise ??= this.bootstrap();

    return this.bootstrapPromise;
  }

  async waitUntilReady(): Promise<void> {
    this.bootstrapPromise ??= this.bootstrap();

    await this.bootstrapPromise;
  }

  private async bootstrap(): Promise<void> {
    const channel = await this.connection.createRawChannel();

    try {
      await this.setupTopology(channel);
      await RetryTopologyBuilder.setup(channel, this.options);

      this.logger.log({
        message: 'RabbitMQ topology bootstrapped',
      });
    } catch (error) {
      this.bootstrapPromise = undefined;

      throw error;
    } finally {
      try {
        await channel.close();
      } catch (error) {
        this.logger.debug({
          message: 'Failed to close topology channel',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  private async setupTopology(channel: Channel): Promise<void> {
    for (const topology of this.options.topology ?? []) {
      const exchangeType = topology.type ?? 'topic';

      await channel.assertExchange(topology.exchange, exchangeType, {
        durable: topology.durable ?? true,
      });

      for (const queue of topology.queues) {
        await this.setupQueue({
          channel,
          exchange: topology.exchange,
          exchangeType,
          queue,
        });
      }
    }
  }

  private async setupQueue(params: {
    channel: Channel;
    exchange: string;
    exchangeType: 'direct' | 'topic' | 'fanout' | 'headers';
    queue: RmqQueueDefinition;
  }): Promise<void> {
    const { channel, exchange, exchangeType, queue } = params;

    const deadLetterExchange = queue.deadLetterQueue
      ? await this.resolveDeadLetterExchange({
          channel,
          exchange,
          exchangeType,
          queue,
        })
      : undefined;

    await channel.assertQueue(queue.queue, {
      durable: queue.durable ?? true,
      arguments: {
        ...queue.arguments,
        ...(queue.deadLetterQueue &&
          deadLetterExchange && {
            'x-dead-letter-exchange': deadLetterExchange,
            'x-dead-letter-routing-key': queue.deadLetterQueue.routingKey,
          }),
      },
    });

    await channel.bindQueue(queue.queue, exchange, queue.routingKey);

    if (queue.deadLetterQueue) {
      await channel.assertQueue(queue.deadLetterQueue.queue, {
        durable: true,
      });

      await channel.bindQueue(
        queue.deadLetterQueue.queue,
        deadLetterExchange ?? exchange,
        queue.deadLetterQueue.routingKey,
      );
    }
  }

  private async resolveDeadLetterExchange(params: {
    channel: Channel;
    exchange: string;
    exchangeType: 'direct' | 'topic' | 'fanout' | 'headers';
    queue: RmqQueueDefinition;
  }): Promise<string> {
    const { channel, exchange, exchangeType, queue } = params;

    if (exchangeType !== 'fanout') {
      return exchange;
    }

    const deadLetterExchangeName = `${exchange}.dlx.${queue.queue}`;

    await channel.assertExchange(deadLetterExchangeName, 'direct', {
      durable: true,
    });

    return deadLetterExchangeName;
  }
}
