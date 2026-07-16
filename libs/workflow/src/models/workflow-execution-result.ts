import { WorkflowStatus } from '../types/workflow-status';

export interface WorkflowExecutionResult {
  readonly workflowId: string;

  readonly status: WorkflowStatus;

  readonly currentStep?: string | undefined;

  readonly iteration: number;

  readonly data: Readonly<Record<string, unknown>>;
}
