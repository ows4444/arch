import { QueueOutboxEntity } from './queue-outbox.entity';
import { QueueInboxEntity } from './queue-inbox.entity';

export const QUEUE_TYPEORM_ENTITIES = [
  QueueOutboxEntity,
  QueueInboxEntity,
] as const;

export { QueueOutboxEntity } from './queue-outbox.entity';
export type { QueueOutboxStatus } from './queue-outbox.entity';
export { QueueInboxEntity } from './queue-inbox.entity';
