import { Inject, Injectable } from '@nestjs/common';
import { WorkflowStateService } from '../state/service';
import { WorkflowRegistry } from '../registry/registry';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';
import { WORKFLOW_TRANSACTION_RUNNER } from '../../constants/workflow.tokens';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';

@Injectable()
export class WorkflowExpirationService {
  constructor(
    private readonly stateService: WorkflowStateService,
    private readonly registry: WorkflowRegistry,
    private readonly children: ChildWorkflowService,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async expire(workflowId: string): Promise<void> {
    await this.transactionRunner.executeOrJoin(async () => {
      const state = await this.stateService.cancel(workflowId, true);
      const workflow = this.registry.get(
        state.workflowName,
        state.workflowVersion,
      );

      this.transactionRunner.afterCommit?.(() =>
        this.children.cancelChildren(workflow, state),
      );
    });
  }
}
