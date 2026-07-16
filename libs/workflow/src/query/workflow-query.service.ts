import { WorkflowExecutionState } from '../models/workflow-execution-state';
import { WorkflowDetails } from '../types/workflow-details';

export interface IWorkflowQueryService {
  get(workflowId: string): Promise<WorkflowDetails>;

  exists(workflowId: string): Promise<boolean>;

  active(workflowName?: string): Promise<WorkflowExecutionState[]>;

  correlation(correlationId: string): Promise<WorkflowExecutionState[]>;

  running(): Promise<WorkflowExecutionState[]>;

  waiting(): Promise<WorkflowExecutionState[]>;

  failed(): Promise<WorkflowExecutionState[]>;
}
