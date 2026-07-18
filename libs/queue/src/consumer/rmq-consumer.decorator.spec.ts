import { Reflector } from '@nestjs/core';
import { RMQConsumer } from './rmq-consumer.decorator';
import { RMQ_HANDLER_METADATA } from '../queue.constants';
import type { RmqConsumerOptions } from '../queue.types';

const QUEUE_REF = {
  EXCHANGE_NAME: 'orders',
  QUEUE_NAME: 'orders.created',
  ROUTING_KEY: 'orders.created',
};

describe('RMQConsumer', () => {
  it('sets handler metadata derived from the queue reference', () => {
    class Handler {
      @RMQConsumer(QUEUE_REF)
      handle(): void {
        // no-op
      }
    }

    const metadata = new Reflector().get<RmqConsumerOptions | undefined>(
      RMQ_HANDLER_METADATA,
      Handler.prototype.handle,
    );

    expect(metadata).toEqual({
      exchange: 'orders',
      queue: 'orders.created',
      routingKey: 'orders.created',
    });
  });

  it('includes prefetch, payload type, and retry policy when provided', () => {
    class Payload {}

    class Handler {
      @RMQConsumer(
        { ...QUEUE_REF, RETRY_POLICY: { strategy: [5, 30] } },
        { payload: Payload, prefetch: 25, timeoutMs: 10_000 },
      )
      handle(): void {
        // no-op
      }
    }

    const metadata = new Reflector().get<RmqConsumerOptions | undefined>(
      RMQ_HANDLER_METADATA,
      Handler.prototype.handle,
    );

    expect(metadata).toEqual({
      exchange: 'orders',
      queue: 'orders.created',
      routingKey: 'orders.created',
      payloadType: Payload,
      prefetch: 25,
      timeoutMs: 10_000,
      retryPolicy: { strategy: [5, 30] },
    });
  });
});
