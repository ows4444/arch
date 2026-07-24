import { In } from 'typeorm';
import { BaseRepository, DatabaseRepository } from '@/database';
import { ScheduledJobEntity } from './scheduled-job.entity';

@DatabaseRepository(ScheduledJobEntity)
export class ScheduledJobRepository extends BaseRepository<ScheduledJobEntity> {
  protected readonly entity = ScheduledJobEntity;

  findByName(name: string): Promise<ScheduledJobEntity | null> {
    return this.findOneBy({ name });
  }

  /**
   * Select-candidates-then-conditional-UPDATE claim, the same idiom
   * `OutboxRepository.claimBatch`/`TypeOrmWorkflowScheduleStore.claimDue`
   * already use — a second replica racing on the same row simply matches 0
   * rows in its own `UPDATE`, so no lock/lease is needed. See
   * `libs/scheduler/ARCH.md` Design 001, Key Decisions HIGH #2.
   */
  async claimDue(
    owner: string,
    now: Date,
    claimStaleMs: number,
    limit: number,
  ): Promise<ScheduledJobEntity[]> {
    return this.runWrite(async () => {
      const claimStaleBefore = new Date(now.getTime() - claimStaleMs);

      const candidates = await this.repository
        .createQueryBuilder('j')
        .select('j.name', 'name')
        .where('j.enabled = :enabled AND j.nextFireAt <= :now', {
          enabled: true,
          now,
        })
        .andWhere('(j.claimedAt IS NULL OR j.claimedAt < :claimStaleBefore)', {
          claimStaleBefore,
        })
        .limit(limit)
        .getRawMany<{ name: string }>();

      const names = candidates.map((candidate) => candidate.name);

      if (names.length === 0) {
        return [];
      }

      await this.repository
        .createQueryBuilder()
        .update()
        .set({ claimedBy: owner, claimedAt: now })
        .where(
          'name IN (:...names) AND (claimedAt IS NULL OR claimedAt < :claimStaleBefore)',
          { names, claimStaleBefore },
        )
        .execute();

      return this.repository.find({
        where: { name: In(names), claimedBy: owner },
      });
    });
  }

  async recordFired(
    name: string,
    firedAt: Date,
    nextFireAt: Date,
  ): Promise<void> {
    await this.update(
      { name },
      { lastFiredAt: firedAt, nextFireAt, claimedBy: null, claimedAt: null },
    );
  }

  async release(name: string): Promise<void> {
    await this.update({ name }, { claimedBy: null, claimedAt: null });
  }
}
