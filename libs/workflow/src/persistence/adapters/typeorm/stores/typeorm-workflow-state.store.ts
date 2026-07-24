import { Inject, Injectable } from '@nestjs/common';
import {
  FindOptionsWhere,
  In,
  IsNull,
  LessThan,
  LessThanOrEqual,
  Not,
  Repository,
} from 'typeorm';
import { WorkflowStateEntity } from '../entities/workflow-state.entity';
import { WorkflowStateMapper } from '../mappers/workflow-state.mapper';
import { isDuplicateKeyError } from '../utils/is-duplicate-query-error';
import { WorkflowConcurrencyError } from '../../../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../../../models/workflow-execution-state';
import { WorkflowStateStore } from '../../../../ports/workflow-state-store';
import { WorkflowStatus } from '../../../../types/workflow-status';
import { WorkflowQueryStore } from '../../../../ports/workflow-query.store';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';

@Injectable()
export class TypeOrmWorkflowStateStore
  implements WorkflowStateStore, WorkflowQueryStore
{
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowStateEntity> {
    return this.managerProvider.manager().getRepository(WorkflowStateEntity);
  }

  async findByCorrelationId(
    correlationId: string,
  ): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: { correlationId },
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findActive(workflowName?: string): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: {
          ...(workflowName && { workflowName }),
          status: In(['running', 'waiting', 'sleeping']),
        },
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findByParentWorkflowId(
    parentWorkflowId: string,
  ): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: { parentWorkflowId },
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async acquireLease(
    workflowId: string,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
      })
      .where('workflowId = :workflowId', { workflowId })
      .andWhere(
        '(leaseExpiresAt IS NULL OR leaseExpiresAt < :now OR leaseOwner = :owner)',
        {
          now: new Date(),
          owner,
        },
      )
      .execute();

    return result.affected === 1;
  }

  async renewLease(
    workflowId: string,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update()
      .set({
        leaseExpiresAt: expiresAt,
      })
      .where('workflowId = :workflowId', { workflowId })
      .andWhere('leaseOwner = :owner', { owner })
      .execute();

    return result.affected === 1;
  }

  async releaseLease(workflowId: string, owner: string): Promise<void> {
    await this.repository.update(
      {
        workflowId,
        leaseOwner: owner,
      },
      {
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    );
  }

  async insert(state: WorkflowExecutionState): Promise<void> {
    try {
      await this.repository.insert(WorkflowStateMapper.toPersistence(state));
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new WorkflowConcurrencyError(
          `Workflow '${state.workflowId}' already exists`,
        );
      }

      throw error;
    }
  }

  async findRecoverable(
    readyAt = new Date(),
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: [
          { requiresRecovery: true, retryAt: IsNull() },
          { requiresRecovery: true, retryAt: LessThanOrEqual(readyAt) },
        ],
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findStuck(
    olderThanMs: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    const threshold = new Date(Date.now() - olderThanMs);

    return this.repository
      .find({
        where: { status: 'running', stepStartedAt: LessThan(threshold) },
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findPendingEffects(
    olderThanMs: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    const threshold = new Date(Date.now() - olderThanMs);

    return this.repository
      .find({
        where: {
          pendingEffect: Not(IsNull()),
          updatedAt: LessThan(threshold),
        },
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findRunning(): Promise<WorkflowExecutionState[]> {
    return this.findByStatus('running');
  }

  async findFailed(): Promise<WorkflowExecutionState[]> {
    return this.findByStatus('failed');
  }

  async load(workflowId: string): Promise<WorkflowExecutionState | null> {
    const entity = await this.repository.findOne({
      where: {
        workflowId,
      },
    });

    return entity ? WorkflowStateMapper.toDomain(entity) : null;
  }

  async findWaiting(): Promise<WorkflowExecutionState[]> {
    return this.findByStatus('waiting');
  }

  async findWaitingChildren(limit?: number): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: { status: 'waiting-children' },
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findWaitingExpired(
    olderThanMs: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    const threshold = new Date(Date.now() - olderThanMs);

    return this.repository
      .find({
        where: { status: 'waiting', waitingSince: LessThan(threshold) },
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async findSleepingReady(
    readyAt = new Date(),
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: { status: 'sleeping', sleepUntil: LessThanOrEqual(readyAt) },
        ...(limit !== undefined ? { take: limit } : {}),
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async save(
    previousState: WorkflowExecutionState,
    nextState: WorkflowExecutionState,
  ): Promise<WorkflowExecutionState> {
    const payload = WorkflowStateMapper.toPersistence(nextState);
    delete payload.leaseOwner;
    delete payload.leaseExpiresAt;

    const result = await this.repository.update(
      {
        workflowId: previousState.workflowId,
        stateVersion: previousState.stateVersion,
      },
      payload,
    );

    if (result.affected !== 1) {
      throw new WorkflowConcurrencyError(
        `Workflow '${nextState.workflowId}' version mismatch`,
      );
    }

    return nextState;
  }

  private async findByStatus(
    status: WorkflowStatus,
  ): Promise<WorkflowExecutionState[]> {
    return this.repository
      .find({
        where: { status },
      })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async deleteCompleted(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs = 0,
  ): Promise<number> {
    const threshold = new Date(Date.now() - olderThanMs);

    const qb = this.repository
      .createQueryBuilder()
      .delete()
      .from(WorkflowStateEntity)
      .where('status = :status', { status: 'completed' })
      .andWhere('completedAt < :threshold', { threshold });

    if (workflowName !== undefined) {
      qb.andWhere('workflowName = :workflowName', { workflowName });
    }

    if (workflowVersion !== undefined) {
      qb.andWhere('workflowVersion = :workflowVersion', {
        workflowVersion,
      });
    }

    const result = await qb.execute();

    return result.affected ?? 0;
  }

  async findCompleted(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs = 0,
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    const threshold = new Date(Date.now() - olderThanMs);

    const where: FindOptionsWhere<WorkflowStateEntity> = {
      status: 'completed',
      completedAt: LessThan(threshold),
    };

    if (workflowName !== undefined) {
      where.workflowName = workflowName;
    }

    if (workflowVersion !== undefined) {
      where.workflowVersion = workflowVersion;
    }

    return this.repository
      .find({ where, ...(limit !== undefined ? { take: limit } : {}) })
      .then((entities) => entities.map((e) => WorkflowStateMapper.toDomain(e)));
  }

  async delete(workflowId: string): Promise<void> {
    await this.repository.delete({
      workflowId,
    });
  }
}
