import { Injectable } from '@nestjs/common';
import { RegisteredWorkflow } from '../models/registered-workflow';
import { WorkflowExecutionState } from '../models/workflow-execution-state';
import { WorkflowSnapshotStore } from '../ports/workflow-snapshot.store';

@Injectable()
export class NoopWorkflowSnapshotStore implements WorkflowSnapshotStore {
  load(): Promise<WorkflowExecutionState | null> {
    return Promise.resolve(null);
  }

  async snapshot(
    _workflow: RegisteredWorkflow,
    _state: WorkflowExecutionState,
  ): Promise<void> {}
}
