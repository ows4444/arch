import type { Channel } from 'amqplib';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { RMQ_MAX_ENTITY_NAME_BYTES } from '../queue.constants';
import type { QueueModuleOptions } from '../queue.types';
import { buildRetryQueueName } from './retry-queue.naming';

function toMilliseconds(seconds: number): number {
  return seconds * 1000;
}

export class RetryTopologyBuilder {
  private static readonly MAX_RETRY_QUEUE_LENGTH = 100_000;

  static async setup(
    channel: Channel,
    options: QueueModuleOptions,
  ): Promise<void> {
    const declaredQueues = new Set<string>();

    for (const topology of options.topology ?? []) {
      for (const queue of topology.queues) {
        const retryPolicy = queue.retryPolicy;

        if (!retryPolicy) {
          continue;
        }

        for (const delaySeconds of retryPolicy.strategy) {
          const retryQueue = buildRetryQueueName({
            exchange: topology.exchange,
            queue: queue.queue,
            delaySeconds,
          });

          if (
            Buffer.byteLength(retryQueue, 'utf8') > RMQ_MAX_ENTITY_NAME_BYTES
          ) {
            throw new QueueConfigurationError(
              `Retry queue name exceeds RabbitMQ limit: ${retryQueue}`,
            );
          }

          if (declaredQueues.has(retryQueue)) {
            continue;
          }

          declaredQueues.add(retryQueue);

          await channel.assertQueue(retryQueue, {
            durable: true,
            arguments: {
              'x-message-ttl': toMilliseconds(delaySeconds),
              'x-dead-letter-exchange': topology.exchange,
              'x-dead-letter-routing-key': queue.routingKey,
              'x-max-length': RetryTopologyBuilder.MAX_RETRY_QUEUE_LENGTH,
              'x-overflow': 'reject-publish',
            },
          });
        }
      }
    }
  }
}
