import { WorkflowExecutionState } from '../../../../models/workflow-execution-state';
import { WorkflowSnapshotEntity } from '../entities/workflow-snapshot.entity';

export class WorkflowSnapshotMapper {
  static toPersistence(
    state: WorkflowExecutionState,
  ): Partial<WorkflowSnapshotEntity> {
    return {
      workflowId: state.workflowId,
      workflowName: state.workflowName,
      workflowVersion: state.workflowVersion,
      stateVersion: state.stateVersion,
      historyCount: state.historyCount,
      state,
      createdAt: new Date(),
    };
  }

  static toDomain(entity: WorkflowSnapshotEntity): WorkflowExecutionState {
    return entity.state;
  }
}
