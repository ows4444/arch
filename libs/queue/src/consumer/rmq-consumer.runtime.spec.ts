import type { Channel, ConsumeMessage } from 'amqplib';
import { RMQConsumerRuntime } from './rmq-consumer.runtime';
import { RMQConnection } from '../connection/rmq.connection';
import {
  RMQHandlerRegistry,
  RMQHandlerDefinition,
} from './rmq-handler.registry';
import { RMQContextFactory } from '../context/rmq-context.factory';
import { TopologyBootstrap } from '../topology/topology.bootstrap';
import { RMQPublisher } from '../publisher/rmq.publisher';
import { RetryableMessageError } from '../errors/retryable-message.error';
import { NonRetryableMessageError } from '../errors/non-retryable-message.error';
import { RMQ_HEADERS } from '../queue.constants';
import type { QueueInboxService } from '../inbox/queue-inbox.service';

const REQUEST_ID = '6e32be35-96d6-4cc8-9d4a-22bb9ac7edd9';

function fakeMessage(overrides: Partial<ConsumeMessage> = {}): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify({ a: 1 })),
    fields: { routingKey: 'rk', exchange: 'ex', deliveryTag: 1 } as never,
    properties: {
      messageId: 'msg-1',
      headers: { [RMQ_HEADERS.REQUEST_ID]: REQUEST_ID },
    } as never,
    ...overrides,
  };
}

function fakeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    ack: jest.fn(),
    nack: jest.fn(),
    ...overrides,
  } as unknown as Channel;
}

function fakeHandler(
  invoke: RMQHandlerDefinition['invoke'],
  overrides: Partial<RMQHandlerDefinition['options']> = {},
): RMQHandlerDefinition {
  return {
    options: {
      exchange: 'ex',
      queue: 'q1',
      routingKey: 'rk',
      ...overrides,
    },
    invoke,
  };
}

const passthroughInbox: QueueInboxService = {
  withIdempotency: async (_consumerKey, _messageId, operation) => {
    await operation();
    return true;
  },
};

function buildRuntime(
  publisher: RMQPublisher,
  inbox: QueueInboxService = passthroughInbox,
): RMQConsumerRuntime {
  return new RMQConsumerRuntime(
    {} as RMQConnection,
    {} as RMQHandlerRegistry,
    new RMQContextFactory(),
    {} as TopologyBootstrap,
    publisher,
    inbox,
  );
}

function fakePublisher(overrides: Partial<RMQPublisher> = {}): RMQPublisher {
  return {
    publish: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as RMQPublisher;
}

type RuntimeWithPrivateAccess = {
  consumeMessage(params: {
    channel: Channel;
    message: ConsumeMessage;
    handler: RMQHandlerDefinition;
  }): Promise<void>;
  inflightCount: number;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('RMQConsumerRuntime message settlement', () => {
  it('acks the message once the handler succeeds', async () => {
    const channel = fakeChannel();
    const runtime = buildRuntime(fakePublisher());
    const handler = fakeHandler(() => Promise.resolve());

    await (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
      channel,
      message: fakeMessage(),
      handler,
    });

    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('does not nack a successfully-handled message when ack() itself fails (regression)', async () => {
    const channel = fakeChannel({
      ack: jest.fn(() => {
        throw new Error('channel closed');
      }),
    });
    const runtime = buildRuntime(fakePublisher());
    const handler = fakeHandler(() => Promise.resolve());

    await expect(
      (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
        channel,
        message: fakeMessage(),
        handler,
      }),
    ).resolves.toBeUndefined();

    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks without requeue for a non-retryable handler failure', async () => {
    const channel = fakeChannel();
    const runtime = buildRuntime(fakePublisher());
    const handler = fakeHandler(() =>
      Promise.reject(new NonRetryableMessageError('bad payload')),
    );

    await (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
      channel,
      message: fakeMessage(),
      handler,
    });

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it('publishes a retry and acks the original message for a retryable failure', async () => {
    const channel = fakeChannel();
    const publisher = fakePublisher();
    const runtime = buildRuntime(publisher);
    const handler = fakeHandler(
      () => Promise.reject(new RetryableMessageError('transient')),
      { retryPolicy: { strategy: [5, 10] } },
    );

    await (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
      channel,
      message: fakeMessage(),
      handler,
    });

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('does not nack when the retry was published successfully but acking the original message fails (regression)', async () => {
    const channel = fakeChannel({
      ack: jest.fn(() => {
        throw new Error('channel closed');
      }),
    });
    const publisher = fakePublisher();
    const runtime = buildRuntime(publisher);
    const handler = fakeHandler(
      () => Promise.reject(new RetryableMessageError('transient')),
      { retryPolicy: { strategy: [5, 10] } },
    );

    await expect(
      (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
        channel,
        message: fakeMessage(),
        handler,
      }),
    ).resolves.toBeUndefined();

    expect(publisher.publish).toHaveBeenCalledTimes(1);

    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks with requeue when the retry-publish itself fails with a transient error', async () => {
    const channel = fakeChannel();
    const publisher = fakePublisher({
      publish: jest.fn().mockRejectedValue(new Error('connection closed')),
    });
    const runtime = buildRuntime(publisher);
    const handler = fakeHandler(
      () => Promise.reject(new RetryableMessageError('transient')),
      { retryPolicy: { strategy: [5, 10] } },
    );

    await (runtime as unknown as RuntimeWithPrivateAccess).consumeMessage({
      channel,
      message: fakeMessage(),
      handler,
    });

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it('does not decrement the inflight count until the handler actually finishes, even after it times out (regression)', async () => {
    jest.useFakeTimers();

    try {
      const channel = fakeChannel();
      const runtime = buildRuntime(fakePublisher());
      const work = deferred<void>();
      const handler = fakeHandler(() => work.promise);

      const runtimeInternals = runtime as unknown as RuntimeWithPrivateAccess;

      const consumePromise = runtimeInternals.consumeMessage({
        channel,
        message: fakeMessage(),
        handler,
      });

      await jest.advanceTimersByTimeAsync(60_000);
      await consumePromise;

      expect(channel.nack).toHaveBeenCalledWith(
        expect.anything(),
        false,
        false,
      );
      expect(runtimeInternals.inflightCount).toBe(1);

      work.resolve();
      await jest.advanceTimersByTimeAsync(0);

      expect(runtimeInternals.inflightCount).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retries a timed-out handler when a retry policy is configured', async () => {
    jest.useFakeTimers();

    try {
      const channel = fakeChannel();
      const publisher = fakePublisher();
      const runtime = buildRuntime(publisher);

      const handler = fakeHandler(() => new Promise<void>(() => undefined), {
        retryPolicy: { strategy: [5, 10] },
      });

      const consumePromise = (
        runtime as unknown as RuntimeWithPrivateAccess
      ).consumeMessage({
        channel,
        message: fakeMessage(),
        handler,
      });

      await jest.advanceTimersByTimeAsync(60_000);
      await consumePromise;

      expect(publisher.publish).toHaveBeenCalledTimes(1);
      expect(channel.ack).toHaveBeenCalledTimes(1);
      expect(channel.nack).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('honors a per-consumer timeoutMs override instead of the 60s default', async () => {
    jest.useFakeTimers();

    try {
      const channel = fakeChannel();
      const publisher = fakePublisher();
      const runtime = buildRuntime(publisher);

      const handler = fakeHandler(() => new Promise<void>(() => undefined), {
        timeoutMs: 1_000,
      });

      const consumePromise = (
        runtime as unknown as RuntimeWithPrivateAccess
      ).consumeMessage({
        channel,
        message: fakeMessage(),
        handler,
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await consumePromise;

      expect(channel.nack).toHaveBeenCalledWith(
        expect.anything(),
        false,
        false,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('RMQConsumerRuntime.onApplicationShutdown', () => {
  it('closes the shared connection only after consumers are cancelled and drained', async () => {
    const callOrder: string[] = [];

    const consumerWrapper = {
      cancel: jest.fn().mockImplementation(() => {
        callOrder.push('cancel');
        return Promise.resolve();
      }),
      close: jest.fn().mockImplementation(() => {
        callOrder.push('wrapper-close');
        return Promise.resolve();
      }),
    };

    const connection = {
      close: jest.fn().mockImplementation(() => {
        callOrder.push('connection-close');
        return Promise.resolve();
      }),
    } as unknown as RMQConnection;

    const runtime = new RMQConsumerRuntime(
      connection,
      {} as RMQHandlerRegistry,
      new RMQContextFactory(),
      {} as TopologyBootstrap,
      fakePublisher(),
      passthroughInbox,
    );

    (
      runtime as unknown as {
        consumers: { wrapper: typeof consumerWrapper; consumerTag?: string }[];
      }
    ).consumers.push({ wrapper: consumerWrapper, consumerTag: 'tag-1' });

    await runtime.onApplicationShutdown();

    expect(callOrder).toEqual(['cancel', 'wrapper-close', 'connection-close']);
  });
});
