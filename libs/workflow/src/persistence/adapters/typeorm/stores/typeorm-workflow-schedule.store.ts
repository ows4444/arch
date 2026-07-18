import { Inject, Injectable } from '@nestjs/common';
import { In, Repository } from 'typeorm';

import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';
import { isDuplicateKeyError } from '../utils/is-duplicate-query-error';
import { WorkflowConcurrencyError } from '../../../../errors/workflow.errors';
import { WorkflowSchedule } from '../../../../models/workflow-schedule';
import { WorkflowScheduleStore } from '../../../../ports/workflow-schedule.store';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WorkflowScheduleEntity } from '../entities/workflow-schedule.entity';
import { WorkflowScheduleMapper } from '../mappers/workflow-schedule.mapper';

@Injectable()
export class TypeOrmWorkflowScheduleStore implements WorkflowScheduleStore {
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowScheduleEntity> {
    return this.managerProvider.manager().getRepository(WorkflowScheduleEntity);
  }

  async insert(schedule: WorkflowSchedule): Promise<void> {
    try {
      await this.repository.insert(
        WorkflowScheduleMapper.toPersistence(schedule),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new WorkflowConcurrencyError(
          `Schedule '${schedule.scheduleId}' already exists`,
        );
      }

      throw error;
    }
  }

  async load(scheduleId: string): Promise<WorkflowSchedule | null> {
    const entity = await this.repository.findOne({ where: { scheduleId } });

    return entity ? WorkflowScheduleMapper.toDomain(entity) : null;
  }

  async findAll(): Promise<WorkflowSchedule[]> {
    return this.repository
      .find()
      .then((entities) =>
        entities.map((e) => WorkflowScheduleMapper.toDomain(e)),
      );
  }

  async setEnabled(scheduleId: string, enabled: boolean): Promise<void> {
    await this.repository.update({ scheduleId }, { enabled });
  }

  async delete(scheduleId: string): Promise<void> {
    await this.repository.delete({ scheduleId });
  }

  async claimDue(
    owner: string,
    now: Date,
    claimStaleAfterMs: number,
    limit?: number,
  ): Promise<WorkflowSchedule[]> {
    const claimStaleBefore = new Date(now.getTime() - claimStaleAfterMs);

    const candidates = await this.repository
      .createQueryBuilder('s')
      .select('s.scheduleId', 'scheduleId')
      .where('s.enabled = :enabled AND s.nextFireAt <= :now', {
        enabled: true,
        now,
      })
      .andWhere('(s.claimedAt IS NULL OR s.claimedAt < :claimStaleBefore)', {
        claimStaleBefore,
      })
      .limit(limit)
      .getRawMany<{ scheduleId: string }>();

    const ids = candidates.map((candidate) => candidate.scheduleId);

    if (ids.length === 0) {
      return [];
    }

    await this.repository
      .createQueryBuilder()
      .update()
      .set({ claimedBy: owner, claimedAt: now })
      .where(
        'scheduleId IN (:...ids) AND (claimedAt IS NULL OR claimedAt < :claimStaleBefore)',
        { ids, claimStaleBefore },
      )
      .execute();

    return this.repository
      .find({ where: { scheduleId: In(ids), claimedBy: owner } })
      .then((entities) =>
        entities.map((e) => WorkflowScheduleMapper.toDomain(e)),
      );
  }

  async recordFired(
    scheduleId: string,
    firedAt: Date,
    nextFireAt: Date,
  ): Promise<void> {
    await this.repository.update(
      { scheduleId },
      {
        lastFiredAt: firedAt,
        nextFireAt,
        claimedBy: null,
        claimedAt: null,
        updatedAt: new Date(),
      },
    );
  }

  async release(scheduleId: string): Promise<void> {
    await this.repository.update(
      { scheduleId },
      { claimedBy: null, claimedAt: null },
    );
  }
}
