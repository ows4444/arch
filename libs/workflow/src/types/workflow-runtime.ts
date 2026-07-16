export interface WorkflowRuntime {
  readonly abortSignal: AbortSignal;

  isCancelled(): Promise<boolean>;
}
