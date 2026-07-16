export interface WorkflowRetryMetadata {
  readonly maxAttempts: number;

  readonly strategy: 'fixed' | 'linear' | 'exponential';

  readonly delayMs?: number;

  readonly maxDelayMs?: number;
}
