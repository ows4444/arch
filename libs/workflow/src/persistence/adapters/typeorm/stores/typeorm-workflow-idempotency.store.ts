import { Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { WorkflowIdempotencyEntity } from '../entities/workflow-idempotency.entity';
import { isDuplicateKeyError } from '../utils/is-duplicate-query-error';
import { WorkflowIdempotencyStore } from '../../../../ports/workflow-idempotency-store';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';

@Injectable()
export class TypeOrmWorkflowIdempotencyStore implements WorkflowIdempotencyStore {
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowIdempotencyEntity> {
    return this.managerProvider
      .manager()
      .getRepository(WorkflowIdempotencyEntity);
  }

  async acquire(key: string, workflowId: string): Promise<boolean> {
    try {
      await this.repository.insert({
        key,
        workflowId,
        completed: false,
        createdAt: new Date(),
      });

      return true;
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return false;
      }

      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.repository.exists({
      where: { key },
    });
  }

  async markCompleted(key: string, workflowId: string): Promise<void> {
    await this.repository.update(
      {
        key,
        workflowId,
      },
      {
        completed: true,
        completedAt: new Date(),
      },
    );
  }

  async release(key: string): Promise<void> {
    await this.repository.delete({ key, completed: false });
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.repository.delete({
      workflowId,
    });
  }
}
