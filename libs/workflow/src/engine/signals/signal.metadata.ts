export interface WorkflowSignalMetadata {
  readonly supportedSignals?: readonly string[];

  readonly defaultTimeoutMs?: number;

  readonly bufferWhileRunning?: boolean;
}
