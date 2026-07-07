import { SetMetadata } from '@nestjs/common';
import { RMQ_HANDLER_METADATA } from '../queue.constants';
import type { RmqConsumerOptions } from '../queue.types';

interface ConsumerDecoratorOptions {
  payload?: RmqConsumerOptions['payloadType'];
  prefetch?: number;
}

interface QueueContract {
  EXCHANGE_NAME: string;
  QUEUE_NAME: string;
  ROUTING_KEY: string;
  RETRY_POLICY?: RmqConsumerOptions['retryPolicy'];
}

export const RMQConsumer = (
  queue: QueueContract,
  options: ConsumerDecoratorOptions = {},
): MethodDecorator =>
  SetMetadata(RMQ_HANDLER_METADATA, {
    exchange: queue.EXCHANGE_NAME,
    queue: queue.QUEUE_NAME,
    routingKey: queue.ROUTING_KEY,
    payloadType: options.payload,
    prefetch: options.prefetch,
    retryPolicy: queue.RETRY_POLICY,
  } satisfies RmqConsumerOptions);
