import type { RMQQueueRef, RmqTopologyDefinition } from '../queue.types';
import { assertEntityName, QueueContractOptions } from './topology.contracts';

export type QueueDefinition = QueueContractOptions;

export interface CompiledQueueDefinition extends RMQQueueRef {
  DURABLE: boolean;

  ARGUMENTS?: Record<string, unknown>;

  DEAD_LETTER_QUEUE?: {
    QUEUE_NAME: string;

    ROUTING_KEY: string;
  };

  RETRY_POLICY?: {
    strategy: number[];
  };
}

export interface CompiledTopology<
  TExchange extends string,
  TQueues extends Record<string, CompiledQueueDefinition>,
> extends RmqTopologyDefinition {
  EXCHANGE_NAME: TExchange;

  TYPE: 'direct' | 'topic' | 'fanout' | 'headers';

  DURABLE: boolean;

  QUEUES: TQueues;
}

export function defineTopology<
  TExchange extends string,
  TQueues extends Record<string, QueueDefinition>,
>(definition: {
  exchange: TExchange;

  type?: 'direct' | 'topic' | 'fanout' | 'headers';

  durable?: boolean;

  queues: TQueues;
}): CompiledTopology<
  TExchange,
  {
    [K in keyof TQueues]: CompiledQueueDefinition;
  }
> {
  const queues = {} as {
    [K in keyof TQueues]: CompiledQueueDefinition;
  };

  assertEntityName(definition.exchange, 'Exchange');

  for (const key in definition.queues) {
    const queue = definition.queues[key];

    if (!queue) {
      continue;
    }

    assertEntityName(queue.routingKey, `Routing key (${key})`);

    assertEntityName(
      queue.queueName ?? queue.routingKey,
      `Queue name (${key})`,
    );

    queues[key] = {
      EXCHANGE_NAME: definition.exchange,

      QUEUE_NAME: queue.queueName ?? queue.routingKey,

      ROUTING_KEY: queue.routingKey,

      DURABLE: queue.durable ?? true,

      ARGUMENTS: queue.arguments ?? {},

      ...(queue.dlq
        ? {
            DEAD_LETTER_QUEUE: {
              QUEUE_NAME: `${queue.queueName ?? queue.routingKey}.dlq`,
              ROUTING_KEY: `${queue.routingKey}.dlq`,
            },
          }
        : {}),

      ...(queue.retry
        ? {
            RETRY_POLICY: {
              strategy: queue.retry.strategy,
            },
          }
        : {}),
    };
  }

  return Object.freeze({
    EXCHANGE_NAME: definition.exchange,
    TYPE: definition.type ?? 'topic',
    DURABLE: definition.durable ?? true,
    exchange: definition.exchange,
    type: definition.type ?? 'topic',
    durable: definition.durable ?? true,
    queues: Object.values(queues).map((queue) => ({
      queue: queue.QUEUE_NAME,
      routingKey: queue.ROUTING_KEY,
      durable: queue.DURABLE,
      arguments: queue.ARGUMENTS ?? {},
      ...(queue.RETRY_POLICY ? { retryPolicy: queue.RETRY_POLICY } : {}),
      ...(queue.DEAD_LETTER_QUEUE
        ? {
            deadLetterQueue: {
              queue: queue.DEAD_LETTER_QUEUE.QUEUE_NAME,
              routingKey: queue.DEAD_LETTER_QUEUE.ROUTING_KEY,
            },
          }
        : {}),
    })),

    QUEUES: queues,
  });
}
