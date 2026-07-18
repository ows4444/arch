import { WorkflowSignalRecord } from '../models/workflow-signal-record';

export interface WorkflowSignalStore {
  load(
    workflowId: string,
    signalId: string,
  ): Promise<WorkflowSignalRecord | null>;

  insert(record: WorkflowSignalRecord): Promise<boolean>;

  markProcessed(workflowId: string, signalId: string): Promise<void>;

  findPending(workflowId: string): Promise<readonly WorkflowSignalRecord[]>;

  exists(workflowId: string, signalId: string): Promise<boolean>;

  deleteByWorkflowId(workflowId: string): Promise<void>;
}
