import { WorkflowSignal } from './workflow-signal';

export interface WorkflowSignalRecord {
  readonly signalId: string;

  readonly workflowId: string;

  readonly signal: WorkflowSignal;

  readonly processed: boolean;

  readonly createdAt: Date;

  readonly processedAt?: Date | undefined;
}
