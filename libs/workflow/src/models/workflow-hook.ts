import { WorkflowExecutionState } from './workflow-execution-state';

export interface WorkflowHook {
  execute(state: WorkflowExecutionState): Promise<void>;
}
