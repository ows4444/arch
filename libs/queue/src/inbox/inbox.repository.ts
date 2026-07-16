import { BaseRepository, DatabaseRepository } from '@/database';
import { QueueInboxEntity } from '../persistence/entities/queue-inbox.entity';

@DatabaseRepository(QueueInboxEntity)
export class InboxRepository extends BaseRepository<QueueInboxEntity> {
  protected readonly entity = QueueInboxEntity;
}
