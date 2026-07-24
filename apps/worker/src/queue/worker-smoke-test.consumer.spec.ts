import { WorkerSmokeTestConsumer } from './worker-smoke-test.consumer';

describe('WorkerSmokeTestConsumer', () => {
  it('logs the received payload without throwing', () => {
    const consumer = new WorkerSmokeTestConsumer();

    expect(() =>
      consumer.handlePing(
        { message: 'hello' },
        {
          requestId: 'req-1',
          correlationId: 'corr-1',
          routingKey: 'worker.smoke-test.ping',
          exchange: 'worker.smoke-test',
          queue: 'worker.smoke-test.ping',
          receivedAt: Date.now(),
          signal: new AbortController().signal,
        },
      ),
    ).not.toThrow();
  });
});
