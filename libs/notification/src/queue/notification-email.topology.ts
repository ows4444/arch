import { defineTopology, queue, retry } from '@/queue';

/**
 * Shared between `apps/server` (publishes via `OutboxService.enqueue`) and
 * `apps/worker` (consumes via `@RMQConsumer`) — defined once here so the
 * exchange/queue/routing-key names can't drift between the two apps. See
 * `libs/notification/ARCH.md`, Context Map.
 */
export const NOTIFICATION_EMAIL_TOPOLOGY = defineTopology({
  exchange: 'notifications.email',
  type: 'topic',
  queues: {
    send: queue({
      routingKey: 'notifications.email.send',
      dlq: true,
      retry: retry({ strategy: [1, 5, 15] }),
    }),
  },
});
