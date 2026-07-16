import { Injectable } from '@nestjs/common';
import { WorkflowArchiveStore } from '../ports/workflow-archive.store';
import { WorkflowDetails } from '../types/workflow-details';

@Injectable()
export class NoopWorkflowArchiveStore implements WorkflowArchiveStore {
  async archive(_workflow: WorkflowDetails): Promise<void> {}
}
