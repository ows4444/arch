import { WORKER_SMOKE_TEST_TOPOLOGY } from './worker-smoke-test.topology';

describe('WORKER_SMOKE_TEST_TOPOLOGY', () => {
  it('compiles the ping queue with a DLQ and retry policy', () => {
    expect(WORKER_SMOKE_TEST_TOPOLOGY.EXCHANGE_NAME).toBe('worker.smoke-test');
    expect(WORKER_SMOKE_TEST_TOPOLOGY.QUEUES.ping).toMatchObject({
      EXCHANGE_NAME: 'worker.smoke-test',
      QUEUE_NAME: 'worker.smoke-test.ping',
      ROUTING_KEY: 'worker.smoke-test.ping',
      DEAD_LETTER_QUEUE: {
        QUEUE_NAME: 'worker.smoke-test.ping.dlq',
        ROUTING_KEY: 'worker.smoke-test.ping.dlq',
      },
      RETRY_POLICY: { strategy: [1, 5, 15] },
    });
  });
});
