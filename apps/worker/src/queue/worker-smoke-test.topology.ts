import { defineTopology, queue, retry } from '@/queue';

/**
 * Proves the outbox → RabbitMQ → consumer → inbox pipeline actually works end-to-end. No
 * business meaning — this is scaffolding for real handlers, not a domain event. See
 * apps/worker/LOOP.md, Loop 002.
 */
export const WORKER_SMOKE_TEST_TOPOLOGY = defineTopology({
  exchange: 'worker.smoke-test',
  type: 'topic',
  queues: {
    ping: queue({
      routingKey: 'worker.smoke-test.ping',
      dlq: true,
      retry: retry({ strategy: [1, 5, 15] }),
    }),
  },
});
