import { In } from 'typeorm';
import { BaseRepository, DatabaseRepository } from '@/database';
import { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';

@DatabaseRepository(QueueOutboxEntity)
export class OutboxRepository extends BaseRepository<QueueOutboxEntity> {
  protected readonly entity = QueueOutboxEntity;

  async claimBatch(
    owner: string,
    batchSize: number,
    leaseMs: number,
  ): Promise<QueueOutboxEntity[]> {
    return this.runWrite(async () => {
      const now = new Date();
      const leaseExpiredBefore = new Date(now.getTime() - leaseMs);

      const candidates = await this.repository
        .createQueryBuilder('o')
        .select('o.id', 'id')
        .where(
          '(o.status = :pending OR (o.status = :publishing AND o.claimedAt < :leaseExpiredBefore)) ' +
            'AND (o.nextAttemptAt IS NULL OR o.nextAttemptAt <= :now)',
          {
            pending: 'pending',
            publishing: 'publishing',
            leaseExpiredBefore,
            now,
          },
        )
        .orderBy('o.createdAt', 'ASC')
        .limit(batchSize)
        .getRawMany<{ id: number }>();

      const ids = candidates.map((candidate) => candidate.id);

      if (ids.length === 0) {
        return [];
      }

      await this.repository
        .createQueryBuilder()
        .update()
        .set({ status: 'publishing', claimedBy: owner, claimedAt: now })
        .where(
          'id IN (:...ids) AND (status = :pending OR (status = :publishing AND claimedAt < :leaseExpiredBefore))',
          {
            ids,
            pending: 'pending',
            publishing: 'publishing',
            leaseExpiredBefore,
          },
        )
        .execute();

      return this.repository.find({
        where: { id: In(ids), claimedBy: owner },
        order: { createdAt: 'ASC' },
      });
    });
  }
}
