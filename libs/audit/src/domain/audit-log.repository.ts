import { BaseRepository, DatabaseRepository } from '@/database';
import { AuditEntryEntity } from './audit-entry.entity';

@DatabaseRepository(AuditEntryEntity)
export class AuditLogRepository extends BaseRepository<AuditEntryEntity> {
  protected readonly entity = AuditEntryEntity;
}
