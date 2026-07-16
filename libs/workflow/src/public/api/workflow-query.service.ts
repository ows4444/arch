import { Injectable } from '@nestjs/common';

import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowSignalService } from '../../engine/signals/signal.service';
import { WorkflowStateService } from '../../engine/state/service';
import { WorkflowHistoryService } from '../../persistence/history.service';
import { WorkflowDetails } from '../../types/workflow-details';
import { IWorkflowQueryService } from '../../query/workflow-query.service';

@Injectable()
export class WorkflowQueryService implements IWorkflowQueryService {
  constructor(
    private readonly stateService: WorkflowStateService,
    private readonly historyService: WorkflowHistoryService,
    private readonly signalService: WorkflowSignalService,
  ) {}

  async get(workflowId: string): Promise<WorkflowDetails> {
    const state = await this.stateService.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    const [history, pendingSignals] = await Promise.all([
      this.historyService.findByWorkflowId(workflowId),
      this.signalService.pending(workflowId),
    ]);

    return {
      state,
      history,
      pendingSignals,
    };
  }

  async exists(workflowId: string): Promise<boolean> {
    return (await this.stateService.load(workflowId)) !== null;
  }

  active(workflowName?: string) {
    return this.stateService.findActive(workflowName);
  }

  correlation(correlationId: string) {
    return this.stateService.findByCorrelationId(correlationId);
  }

  async running() {
    return this.stateService.findRunning();
  }

  async waiting() {
    return this.stateService.findWaiting();
  }

  async failed() {
    return this.stateService.findFailed();
  }
}
