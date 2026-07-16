import { Inject, Injectable, Optional } from '@nestjs/common';

import { WORKFLOW_HISTORY_STORE } from '../constants/workflow.tokens';
import { WorkflowStepExecution } from '../models/workflow-step-execution';
import type { WorkflowExecutionHistoryStore } from '../ports/workflow-execution-history.store';

@Injectable()
export class WorkflowHistoryService {
  constructor(
    @Optional()
    @Inject(WORKFLOW_HISTORY_STORE)
    private readonly store?: WorkflowExecutionHistoryStore,
  ) {}

  async append(
    workflowId: string,
    execution: WorkflowStepExecution,
  ): Promise<void> {
    await this.store?.append(workflowId, execution);
  }

  async findByWorkflowId(
    workflowId: string,
  ): Promise<readonly WorkflowStepExecution[]> {
    return (await this.store?.findByWorkflowId(workflowId)) ?? [];
  }

  async delete(workflowId: string): Promise<void> {
    await this.store?.delete(workflowId);
  }
}
