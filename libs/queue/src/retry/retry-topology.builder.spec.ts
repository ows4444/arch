import type { Channel } from 'amqplib';
import { RetryTopologyBuilder } from './retry-topology.builder';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import type { QueueModuleOptions } from '../queue.types';

function fakeChannel(): Channel {
  return {
    assertQueue: jest.fn().mockResolvedValue(undefined),
  } as unknown as Channel;
}

describe('RetryTopologyBuilder.setup', () => {
  it('declares one retry queue per configured delay with TTL and DLX pointing back at the origin', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'orders',
          queues: [
            {
              queue: 'created',
              routingKey: 'created',
              retryPolicy: { strategy: [5, 30] },
            },
          ],
        },
      ],
    };

    await RetryTopologyBuilder.setup(channel, options);

    const expectedArguments: Record<string, unknown> = {
      'x-message-ttl': 5_000,
      'x-dead-letter-exchange': 'orders',
      'x-dead-letter-routing-key': 'created',
    };

    expect(channel.assertQueue).toHaveBeenCalledTimes(2);
    expect(channel.assertQueue).toHaveBeenCalledWith(
      'orders.created.retry.5s',
      expect.objectContaining({
        durable: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        arguments: expect.objectContaining(expectedArguments),
      }),
    );
  });

  it('does nothing for queues without a retry policy', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'orders',
          queues: [{ queue: 'created', routingKey: 'created' }],
        },
      ],
    };

    await RetryTopologyBuilder.setup(channel, options);

    expect(channel.assertQueue).not.toHaveBeenCalled();
  });

  it('declares the same retry queue only once within a call when two queues share exchange+queue+delay', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'ex',
          queues: [
            { queue: 'q', routingKey: 'q', retryPolicy: { strategy: [5] } },
            { queue: 'q', routingKey: 'q2', retryPolicy: { strategy: [5] } },
          ],
        },
      ],
    };

    await RetryTopologyBuilder.setup(channel, options);

    expect(channel.assertQueue).toHaveBeenCalledTimes(1);
  });

  it('throws QueueConfigurationError when the generated retry queue name exceeds the RabbitMQ limit', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'x'.repeat(250),
          queues: [
            { queue: 'q', routingKey: 'q', retryPolicy: { strategy: [5] } },
          ],
        },
      ],
    };

    await expect(RetryTopologyBuilder.setup(channel, options)).rejects.toThrow(
      QueueConfigurationError,
    );
  });
});
