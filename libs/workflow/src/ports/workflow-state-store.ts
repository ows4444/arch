import { WorkflowExecutionState } from '../models/workflow-execution-state';

export interface WorkflowStateStore {
  insert(state: WorkflowExecutionState): Promise<void>;

  save(
    previousState: WorkflowExecutionState,
    nextState: WorkflowExecutionState,
  ): Promise<WorkflowExecutionState>;

  load(workflowId: string): Promise<WorkflowExecutionState | null>;

  acquireLease?(
    workflowId: string,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean>;

  findByCorrelationId(correlationId: string): Promise<WorkflowExecutionState[]>;

  findActive(workflowName?: string): Promise<WorkflowExecutionState[]>;

  renewLease?(
    workflowId: string,
    owner: string,
    expiresAt: Date,
  ): Promise<boolean>;

  findByParentWorkflowId(
    parentWorkflowId: string,
  ): Promise<WorkflowExecutionState[]>;

  releaseLease?(workflowId: string, owner: string): Promise<void>;

  delete(workflowId: string): Promise<void>;

  findRunning?(): Promise<WorkflowExecutionState[]>;

  findWaiting?(): Promise<WorkflowExecutionState[]>;

  findWaitingExpired?(
    olderThanMs: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]>;

  findFailed?(): Promise<WorkflowExecutionState[]>;

  findCompleted?(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs?: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]>;

  findRecoverable?(
    readyAt?: Date,
    limit?: number,
  ): Promise<WorkflowExecutionState[]>;

  findStuck?(
    olderThanMs: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]>;

  deleteCompleted?(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs?: number,
  ): Promise<number>;
}
