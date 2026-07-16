export interface WorkflowRetryScheduler {
  wait(delayMs: number, signal?: AbortSignal): Promise<void>;
}
