export interface WorkflowRetryJitter {
  apply(baseDelayMs: number, attempt: number): number;
}
