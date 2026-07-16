import { WorkflowExecutionState } from '../models/workflow-execution-state';

export interface WorkflowQueryStore {
  load(workflowId: string): Promise<WorkflowExecutionState | null>;

  findByCorrelationId(correlationId: string): Promise<WorkflowExecutionState[]>;

  findActive(workflowName?: string): Promise<WorkflowExecutionState[]>;

  findRunning?(): Promise<WorkflowExecutionState[]>;

  findWaiting?(): Promise<WorkflowExecutionState[]>;

  findFailed?(): Promise<WorkflowExecutionState[]>;

  findCompleted?(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs?: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]>;
}
