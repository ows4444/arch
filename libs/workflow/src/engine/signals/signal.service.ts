import { Inject, Injectable } from '@nestjs/common';

import { WORKFLOW_SIGNAL_STORE } from '../../constants/workflow.tokens';
import type { WorkflowSignalStore } from '../../ports/workflow-signal.store';
import { WorkflowSignal } from '../../models/workflow-signal';

@Injectable()
export class WorkflowSignalService {
  constructor(
    @Inject(WORKFLOW_SIGNAL_STORE)
    private readonly store: WorkflowSignalStore,
  ) {}

  async load(workflowId: string, signalId: string) {
    return this.store.load(workflowId, signalId);
  }

  async exists(workflowId: string, signalId: string): Promise<boolean> {
    return this.store.exists(workflowId, signalId);
  }

  async append(workflowId: string, signal: WorkflowSignal): Promise<boolean> {
    return this.store.insert({
      signalId: signal.signalId,
      workflowId,
      signal,
      processed: false,
      createdAt: new Date(),
    });
  }

  async markProcessed(workflowId: string, signalId: string): Promise<void> {
    await this.store.markProcessed(workflowId, signalId);
  }

  async pending(workflowId: string) {
    return this.store.findPending(workflowId);
  }

  async deleteByWorkflowId(workflowId: string): Promise<void> {
    await this.store.deleteByWorkflowId(workflowId);
  }
}
