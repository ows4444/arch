import { WorkflowStepId } from './workflow-step-id';

export interface WorkflowStepExecution {
  readonly step: WorkflowStepId;

  readonly startedAt: Date;

  readonly completedAt?: Date | undefined;

  readonly durationMs?: number | undefined;

  readonly status: 'started' | 'completed' | 'failed';

  readonly error?: string | undefined;
}
