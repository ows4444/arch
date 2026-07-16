import type { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';

export interface QueueOutboxOptions {
  intervalMs?: number | undefined;

  batchSize?: number | undefined;

  leaseMs?: number | undefined;

  maxAttempts?: number | undefined;

  retryBaseMs?: number | undefined;

  retryMaxMs?: number | undefined;

  onExhausted?: ((row: QueueOutboxEntity) => void | Promise<void>) | undefined;
}
