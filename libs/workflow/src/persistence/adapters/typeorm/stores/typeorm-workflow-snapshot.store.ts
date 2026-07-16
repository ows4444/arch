import { Inject, Injectable } from '@nestjs/common';
import { QueryDeepPartialEntity, Repository } from 'typeorm';

import { RegisteredWorkflow } from '../../../../models/registered-workflow';
import { WorkflowExecutionState } from '../../../../models/workflow-execution-state';
import { WorkflowSnapshotStore } from '../../../../ports/workflow-snapshot.store';
import { WorkflowSnapshotEntity } from '../entities/workflow-snapshot.entity';
import { WorkflowSnapshotMapper } from '../mappers/workflow-snapshot.mapper';
import type { WorkflowEntityManagerProvider } from '../../../workflow-entity-manager.provider';
import { WORKFLOW_ENTITY_MANAGER_PROVIDER } from '../../../../constants/workflow.tokens';

@Injectable()
export class TypeOrmWorkflowSnapshotStore implements WorkflowSnapshotStore {
  constructor(
    @Inject(WORKFLOW_ENTITY_MANAGER_PROVIDER)
    private readonly managerProvider: WorkflowEntityManagerProvider,
  ) {}

  private get repository(): Repository<WorkflowSnapshotEntity> {
    return this.managerProvider.manager().getRepository(WorkflowSnapshotEntity);
  }

  async load(workflowId: string): Promise<WorkflowExecutionState | null> {
    const entity = await this.repository.findOne({
      where: { workflowId },
    });

    return entity ? WorkflowSnapshotMapper.toDomain(entity) : null;
  }

  async snapshot(
    _workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    const persistence = WorkflowSnapshotMapper.toPersistence(
      state,
    ) as QueryDeepPartialEntity<WorkflowSnapshotEntity>;

    const existing = await this.repository.findOne({
      where: { workflowId: state.workflowId },
    });

    if (existing) {
      await this.repository.update(
        { workflowId: state.workflowId },
        {
          stateVersion: state.stateVersion,
          historyCount: state.historyCount,
          state: state as QueryDeepPartialEntity<WorkflowExecutionState>,
          createdAt: new Date(),
        },
      );
    } else {
      await this.repository.insert(persistence);
    }
  }
}
