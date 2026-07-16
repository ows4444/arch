import { WorkflowSignalRecord } from '../models/workflow-signal-record';

export interface WorkflowSignalStore {
  load(signalId: string): Promise<WorkflowSignalRecord | null>;

  insert(record: WorkflowSignalRecord): Promise<boolean>;

  markProcessed(signalId: string): Promise<void>;

  findPending(workflowId: string): Promise<readonly WorkflowSignalRecord[]>;

  exists(signalId: string): Promise<boolean>;

  deleteByWorkflowId(workflowId: string): Promise<void>;
}
