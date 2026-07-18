import { buildRetryQueueName } from './retry-queue.naming';

describe('buildRetryQueueName', () => {
  it('builds a deterministic name from exchange, queue and delay', () => {
    expect(
      buildRetryQueueName({
        exchange: 'orders',
        queue: 'created',
        delaySeconds: 30,
      }),
    ).toBe('orders.created.retry.30s');
  });

  it('produces distinct names for distinct delays', () => {
    const a = buildRetryQueueName({
      exchange: 'ex',
      queue: 'q',
      delaySeconds: 5,
    });
    const b = buildRetryQueueName({
      exchange: 'ex',
      queue: 'q',
      delaySeconds: 10,
    });

    expect(a).not.toBe(b);
  });
});
