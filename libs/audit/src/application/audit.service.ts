import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { AuditLogRepository } from '../domain/audit-log.repository';

export interface AuditRecordInput {
  actorId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLogRepository)
    private readonly entries: AuditLogRepository,
  ) {}

  /**
   * Called after the primary mutation succeeds, as a separate write — no
   * code path in this monorepo uses `@Transactional()` (see
   * `libs/audit/ARCH.md`), so this doesn't invent a transactional
   * guarantee between the audited mutation and its log entry. Errors
   * propagate normally rather than being swallowed: silently losing an
   * audit record would defeat the point of keeping one.
   */
  async record(input: AuditRecordInput): Promise<void> {
    await this.entries.save({
      actorId: input.actorId ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      metadata: input.metadata ?? null,
    });
  }
}
