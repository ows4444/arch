export const RMQ_MODULE_OPTIONS = Symbol('RMQ_MODULE_OPTIONS');

export const RMQ_HANDLER_METADATA = Symbol('RMQ_HANDLER_METADATA');

export const RMQ_MAX_RETRY_COUNT = 1000;

export const RMQ_MAX_ENTITY_NAME_BYTES = 255;

export const RMQ_DEFAULT_PREFETCH = 10;

export const RMQ_HEADERS = {
  REQUEST_ID: 'x-request-id',

  CORRELATION_ID: 'x-correlation-id',

  CAUSATION_ID: 'x-causation-id',

  RETRY_COUNT: 'x-retry-count',
} as const;
