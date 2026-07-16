export interface WorkflowMetrics {
  workflowStarted(workflowName: string): void;

  workflowCompleted(workflowName: string): void;

  workflowFailed(workflowName: string): void;

  workflowCancelled(workflowName: string): void;

  workflowRecovered(workflowName: string): void;

  signalReceived(workflowName: string): void;

  retryScheduled(workflowName: string): void;

  stepStarted(workflowName: string, step: string): void;

  stepCompleted(workflowName: string, step: string, durationMs: number): void;

  hookFailed(workflow: string, hook: string): void;

  sweepRecovered(count: number): void;

  sweepStuckDetected(count: number): void;

  sweepExpiredCancelled(count: number): void;

  retentionDeleted(count: number): void;

  retentionArchived(count: number): void;
}
