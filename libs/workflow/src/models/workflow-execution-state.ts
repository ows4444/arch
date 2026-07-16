import { WorkflowStatus } from '../types/workflow-status';
import { WorkflowFailure } from './workflow-failure';
import { WorkflowSignal } from './workflow-signal';
import { WorkflowStepId } from './workflow-step-id';

export interface WorkflowExecutionState<
  TState extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly executionId: string;

  readonly parentWorkflowId?: string | undefined;

  readonly parentExecutionId?: string | undefined;

  readonly correlationId: string;

  readonly workflowId: string;

  readonly workflowName: string;

  readonly status: WorkflowStatus;

  readonly recoveryReason?: 'process-crash' | 'timeout' | 'unknown' | undefined;

  readonly recoveryAttempts?: number | undefined;

  readonly retryAt?: Date | undefined;

  readonly lastRecoveryAt?: Date | undefined;

  readonly waitingForSignal?: WorkflowSignal | undefined;

  readonly waitingSince?: Date | undefined;

  readonly resumeStep?: WorkflowStepId | undefined;

  readonly executingStep?: WorkflowStepId | undefined;

  readonly stepStartedAt?: Date | undefined;

  readonly requiresRecovery?: boolean | undefined;

  readonly leaseOwner?: string | undefined;

  readonly leaseExpiresAt?: Date | undefined;

  readonly historyCount: number;

  readonly lastFailure?: WorkflowFailure | undefined;

  readonly failedStep?: string | undefined;

  readonly failureCount?: number | undefined;

  readonly stepRetryCount?: number | undefined;

  readonly stateVersion: number;

  readonly createdAt: Date;

  readonly updatedAt: Date;

  readonly completedAt?: Date | undefined;

  readonly failedAt?: Date | undefined;

  readonly workflowVersion: number;

  readonly currentStep?: WorkflowStepId | undefined;

  readonly iteration: number;

  readonly data: Readonly<TState>;
}
