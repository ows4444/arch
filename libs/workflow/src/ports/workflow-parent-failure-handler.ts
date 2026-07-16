import { WorkflowExecutionState } from '../models/workflow-execution-state';

export interface WorkflowParentFailureHandler {
  failExecution(state: WorkflowExecutionState, error: unknown): Promise<void>;
}
