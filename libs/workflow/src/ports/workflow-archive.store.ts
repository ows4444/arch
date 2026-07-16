import { WorkflowDetails } from '../types/workflow-details';

export interface WorkflowArchiveStore {
  archive(workflow: WorkflowDetails): Promise<void>;
}
