export interface WorkflowRetentionMetadata {
  readonly ttlMs: number;

  readonly batchSize?: number;

  readonly archiveBeforeDelete?: boolean;
}
