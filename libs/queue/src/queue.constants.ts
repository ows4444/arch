export const RMQ_MODULE_OPTIONS = Symbol('RMQ_MODULE_OPTIONS');

export const RMQ_HANDLER_METADATA = Symbol('RMQ_HANDLER_METADATA');

export const RMQ_MAX_RETRY_COUNT = 1000;

export const RMQ_MAX_ENTITY_NAME_BYTES = 255;

export const RMQ_DEFAULT_PREFETCH = 10;

export const QUEUE_OUTBOX_OPTIONS = Symbol('QUEUE_OUTBOX_OPTIONS');

export const QUEUE_INBOX_SERVICE = Symbol('QUEUE_INBOX_SERVICE');

export const RMQ_HEADERS = {
  REQUEST_ID: 'x-request-id',

  CORRELATION_ID: 'x-correlation-id',

  CAUSATION_ID: 'x-causation-id',

  RETRY_COUNT: 'x-retry-count',
} as const;

/**
 * Internal-only header used to correlate a broker `basic.return` event back
 * to the exact `RMQPublisher.publish()` call that produced it. Deliberately
 * not part of `RMQ_HEADERS`/exposed to consumers — it exists only so
 * unroutable-message detection doesn't key on the caller-supplied AMQP
 * `messageId`, which retries and outbox redelivery legitimately reuse across
 * multiple `publish()` calls for the same logical message.
 */
export const RMQ_INTERNAL_PUBLISH_ID_HEADER = 'x-queue-internal-publish-id';
