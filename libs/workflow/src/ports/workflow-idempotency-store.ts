export interface WorkflowIdempotencyStore {
  acquire(key: string, workflowId: string): Promise<boolean>;

  exists(key: string): Promise<boolean>;

  markCompleted(key: string, workflowId: string): Promise<void>;

  release(key: string): Promise<void>;

  deleteByWorkflowId(workflowId: string): Promise<void>;
}
