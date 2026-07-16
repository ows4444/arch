import { RegisteredWorkflow } from '../models/registered-workflow';
import { WorkflowExecutionState } from '../models/workflow-execution-state';

export interface WorkflowSnapshotStore {
  load(workflowId: string): Promise<WorkflowExecutionState | null>;

  snapshot(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void>;
}
