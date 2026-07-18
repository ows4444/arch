import { SetMetadata } from '@nestjs/common';
import { RMQ_HANDLER_METADATA } from '../queue.constants';
import type { RMQQueueRef, RmqConsumerOptions } from '../queue.types';

interface ConsumerDecoratorOptions {
  payload?: RmqConsumerOptions['payloadType'];
  prefetch?: number;
  timeoutMs?: number;
}

interface QueueContract extends RMQQueueRef {
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
    ...(options.payload && { payloadType: options.payload }),
    ...(options.prefetch !== undefined && { prefetch: options.prefetch }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(queue.RETRY_POLICY && { retryPolicy: queue.RETRY_POLICY }),
  } satisfies RmqConsumerOptions);
