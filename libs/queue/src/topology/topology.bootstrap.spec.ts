import type { Channel } from 'amqplib';
import { TopologyBootstrap } from './topology.bootstrap';
import { RMQConnection } from '../connection/rmq.connection';
import type { QueueModuleOptions } from '../queue.types';

function fakeChannel(): Channel {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Channel;
}

function fakeConnection(channel: Channel): RMQConnection {
  return {
    createRawChannel: jest.fn().mockResolvedValue(channel),
  } as unknown as RMQConnection;
}

describe('TopologyBootstrap dead-letter routing', () => {
  it('routes the DLQ through the main exchange for a topic exchange (unchanged behavior)', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'ex',
          type: 'topic',
          queues: [
            {
              queue: 'q1',
              routingKey: 'rk',
              deadLetterQueue: { queue: 'q1.dlq', routingKey: 'q1.dlq' },
            },
          ],
        },
      ],
    };

    const bootstrap = new TopologyBootstrap(fakeConnection(channel), options);
    await bootstrap.waitUntilReady();

    const call = (channel.assertQueue as jest.Mock).mock.calls[0] as [
      string,
      { arguments: Record<string, unknown> },
    ];

    expect(call[1].arguments['x-dead-letter-exchange']).toBe('ex');
    expect(call[1].arguments['x-dead-letter-routing-key']).toBe('q1.dlq');
    expect(channel.bindQueue).toHaveBeenCalledWith('q1.dlq', 'ex', 'q1.dlq');
  });

  it('routes the DLQ through a dedicated direct exchange for a fanout exchange (regression)', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'ex',
          type: 'fanout',
          queues: [
            {
              queue: 'q1',
              routingKey: 'rk',
              deadLetterQueue: { queue: 'q1.dlq', routingKey: 'q1.dlq' },
            },
          ],
        },
      ],
    };

    const bootstrap = new TopologyBootstrap(fakeConnection(channel), options);
    await bootstrap.waitUntilReady();

    const dedicatedExchange = 'ex.dlx.q1';

    const exchangeCall = (channel.assertExchange as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[0] === dedicatedExchange,
    ) as [string, string, { durable: boolean }] | undefined;

    expect(exchangeCall?.[1]).toBe('direct');
    expect(exchangeCall?.[2].durable).toBe(true);

    const queueCall = (channel.assertQueue as jest.Mock).mock.calls[0] as [
      string,
      { arguments: Record<string, unknown> },
    ];

    expect(queueCall[1].arguments['x-dead-letter-exchange']).toBe(
      dedicatedExchange,
    );

    expect(channel.bindQueue).toHaveBeenCalledWith(
      'q1.dlq',
      dedicatedExchange,
      'q1.dlq',
    );
    expect(channel.bindQueue).not.toHaveBeenCalledWith(
      'q1.dlq',
      'ex',
      expect.anything(),
    );
  });

  it('sets no dead-letter arguments when the queue has no deadLetterQueue configured', async () => {
    const channel = fakeChannel();
    const options: QueueModuleOptions = {
      uri: 'amqp://localhost',
      topology: [
        {
          exchange: 'ex',
          type: 'fanout',
          queues: [{ queue: 'q1', routingKey: 'rk' }],
        },
      ],
    };

    const bootstrap = new TopologyBootstrap(fakeConnection(channel), options);
    await bootstrap.waitUntilReady();

    const call = (channel.assertQueue as jest.Mock).mock.calls[0] as [
      string,
      { arguments: Record<string, unknown> },
    ];

    expect(call[1].arguments['x-dead-letter-exchange']).toBeUndefined();
  });
});
