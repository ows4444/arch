import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { RMQ_MAX_ENTITY_NAME_BYTES } from '../queue.constants';

export interface RetryPolicyDefinition {
  strategy: number[];
}

export interface ResolvedRetryPolicy {
  strategy: number[];
}

const MAX_RETRY_DELAY_SECONDS = 2_592_000;

function validateRetryStrategy(strategy: number[]): void {
  if (strategy.length === 0) {
    throw new QueueConfigurationError('Retry strategy cannot be empty');
  }

  for (let index = 0; index < strategy.length; index += 1) {
    const delay = strategy[index];

    if (typeof delay !== 'number') {
      throw new QueueConfigurationError(
        `Retry strategy must be an array of numbers. Received: ${typeof delay}`,
      );
    }

    if (delay > MAX_RETRY_DELAY_SECONDS) {
      throw new QueueConfigurationError(
        `Retry delay cannot exceed ${MAX_RETRY_DELAY_SECONDS} seconds. Received: ${delay}`,
      );
    }

    if (!Number.isInteger(delay) || delay <= 0) {
      throw new QueueConfigurationError(
        `Retry delay must be a positive integer. Received: ${delay}`,
      );
    }

    const previous = strategy[index - 1];

    if (previous !== undefined && delay <= previous) {
      throw new QueueConfigurationError(
        'Retry strategy must be strictly increasing',
      );
    }
  }
}

export function assertEntityName(value: string, field: string): void {
  if (!value.trim()) {
    throw new QueueConfigurationError(`${field} cannot be empty`);
  }

  if (Buffer.byteLength(value, 'utf8') > RMQ_MAX_ENTITY_NAME_BYTES) {
    throw new QueueConfigurationError(`${field} exceeds RabbitMQ limit`);
  }
}

export interface QueueContractOptions {
  queueName?: string;
  routingKey: string;
  durable?: boolean;
  arguments?: Record<string, unknown>;
  retry?: RetryPolicyDefinition;
  dlq?: boolean;
}

export function retry(options: RetryPolicyDefinition): ResolvedRetryPolicy {
  validateRetryStrategy(options.strategy);

  return { ...options };
}

export function queue(options: QueueContractOptions): QueueContractOptions {
  return options;
}
