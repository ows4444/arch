import { WorkflowExecutionState } from './workflow-execution-state';

export interface WorkflowJoinSummary {
  readonly succeeded: readonly WorkflowExecutionState[];

  readonly failed: readonly WorkflowExecutionState[];

  readonly pending: readonly WorkflowExecutionState[];
}
