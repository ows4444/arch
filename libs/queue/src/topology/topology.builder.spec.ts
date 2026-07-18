import { defineTopology } from './topology.builder';
import { QueueConfigurationError } from '../errors/queue-configuration.error';

describe('defineTopology', () => {
  it('builds a compiled topology with defaults applied', () => {
    const topology = defineTopology({
      exchange: 'orders',
      queues: {
        created: { routingKey: 'orders.created' },
      },
    });

    expect(topology.EXCHANGE_NAME).toBe('orders');
    expect(topology.TYPE).toBe('topic');
    expect(topology.DURABLE).toBe(true);
    expect(topology.QUEUES.created).toEqual({
      EXCHANGE_NAME: 'orders',
      QUEUE_NAME: 'orders.created',
      ROUTING_KEY: 'orders.created',
      DURABLE: true,
      ARGUMENTS: {},
    });
    expect(topology.queues).toEqual([
      {
        queue: 'orders.created',
        routingKey: 'orders.created',
        durable: true,
        arguments: {},
      },
    ]);
  });

  it('uses an explicit queueName over the routing key', () => {
    const topology = defineTopology({
      exchange: 'orders',
      queues: {
        created: {
          routingKey: 'orders.created',
          queueName: 'orders-created-q',
        },
      },
    });

    expect(topology.QUEUES.created.QUEUE_NAME).toBe('orders-created-q');
  });

  it('attaches a dead-letter queue definition when dlq is requested', () => {
    const topology = defineTopology({
      exchange: 'orders',
      queues: { created: { routingKey: 'orders.created', dlq: true } },
    });

    expect(topology.QUEUES.created.DEAD_LETTER_QUEUE).toEqual({
      QUEUE_NAME: 'orders.created.dlq',
      ROUTING_KEY: 'orders.created.dlq',
    });
  });

  it('attaches a retry policy when configured', () => {
    const topology = defineTopology({
      exchange: 'orders',
      queues: {
        created: { routingKey: 'orders.created', retry: { strategy: [5, 30] } },
      },
    });

    expect(topology.QUEUES.created.RETRY_POLICY).toEqual({ strategy: [5, 30] });
  });

  it('freezes the returned topology', () => {
    const topology = defineTopology({
      exchange: 'orders',
      queues: { created: { routingKey: 'orders.created' } },
    });

    expect(Object.isFrozen(topology)).toBe(true);
  });

  it('throws QueueConfigurationError for an empty exchange name', () => {
    expect(() => defineTopology({ exchange: '', queues: {} })).toThrow(
      QueueConfigurationError,
    );
  });

  it('throws QueueConfigurationError for an empty routing key', () => {
    expect(() =>
      defineTopology({
        exchange: 'orders',
        queues: { created: { routingKey: '' } },
      }),
    ).toThrow(QueueConfigurationError);
  });
});
