export interface WorkflowAutoResumeMetadata {
  readonly enabled: boolean;

  readonly intervalMs?: number;

  readonly stuckThresholdMs?: number;

  readonly maxAttempts?: number;

  readonly batchSize?: number;
}
