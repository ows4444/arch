import { Inject, Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';

import { WorkflowStepHistoryEntity } from '../entities/workflow-step-history.entity';
import { WorkflowStepExecution } from '../../../../models/workflow-step-execution';
import { WorkflowExecutionHistoryStore } from '../../../../ports/workflow-execution-history.store';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';

@Injectable()
export class TypeOrmWorkflowHistoryStore implements WorkflowExecutionHistoryStore {
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowStepHistoryEntity> {
    return this.managerProvider
      .manager()
      .getRepository(WorkflowStepHistoryEntity);
  }

  async append(
    workflowId: string,
    execution: WorkflowStepExecution,
  ): Promise<void> {
    await this.repository.insert({
      workflowId,
      step: execution.step,
      status: execution.status,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      durationMs: execution.durationMs,
      error: execution.error,
    });
  }

  async findByWorkflowId(
    workflowId: string,
  ): Promise<readonly WorkflowStepExecution[]> {
    const entities = await this.repository.find({
      where: {
        workflowId,
      },
      order: {
        startedAt: 'ASC',
      },
    });

    return entities.map((entity) => ({
      step: entity.step as WorkflowStepExecution['step'],
      startedAt: entity.startedAt,
      completedAt: entity.completedAt,
      durationMs: entity.durationMs,
      status: entity.status as WorkflowStepExecution['status'],
      error: entity.error,
    }));
  }

  async delete(workflowId: string): Promise<void> {
    await this.repository.delete({
      workflowId,
    });
  }
}
