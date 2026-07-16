export interface WorkflowLeaseStore {
  acquire(workflowId: string, owner: string, expiresAt: Date): Promise<boolean>;

  renew(workflowId: string, owner: string, expiresAt: Date): Promise<boolean>;

  release(workflowId: string): Promise<void>;

  releaseExpired(now: Date): Promise<number>;
}
