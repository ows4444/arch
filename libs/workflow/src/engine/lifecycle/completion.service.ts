import { Inject, Injectable } from '@nestjs/common';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowStateService } from '../state/service';
import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowLifecyclePublisher } from './lifecycle.publisher';
import { WORKFLOW_TRANSACTION_RUNNER } from '../../constants/workflow.tokens';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';

@Injectable()
export class WorkflowCompletionService {
  constructor(
    private readonly transitions: WorkflowStateTransitions,
    private readonly stateService: WorkflowStateService,
    private readonly children: ChildWorkflowService,

    private readonly registry: WorkflowRegistry,
    private readonly publisher: WorkflowLifecyclePublisher,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async completeIfFinished(state: WorkflowExecutionState): Promise<{
    state: WorkflowExecutionState;
    completed: boolean;
  }> {
    if (state.status !== 'running' || state.currentStep !== undefined) {
      return {
        state,
        completed: false,
      };
    }

    let workflow = this.registry.get(state.workflowName, state.workflowVersion);

    const children = await this.children.findChildren(state.workflowId);

    const activeManagedChildren = children.filter((child) => {
      if (!this.children.isManagedChild(workflow, child)) {
        return false;
      }

      return (
        child.status !== 'completed' &&
        child.status !== 'failed' &&
        child.status !== 'cancelled'
      );
    });

    if (activeManagedChildren.length > 0) {
      return {
        state,
        completed: false,
      };
    }

    const next = this.transitions.completeWorkflow(state);

    const persisted = await this.transactionRunner.executeOrJoin(() =>
      this.stateService.save(state, next),
    );

    workflow = this.registry.get(
      persisted.workflowName,
      persisted.workflowVersion,
    );

    const parent = await this.children.findParent(persisted);

    if (parent) {
      // onChildCompleted() can synchronously resume the parent at its join
      // step via checkJoinQuorum()/resumeJoin() when this child completes a
      // fan-out quorum — that runs real step logic, not just a state flip.
      // Calling it inline here would nest the parent's join-step execution
      // inside this child's own still-open completion transaction (holding
      // its connection/locks for the duration, and potentially nesting a
      // second transaction inside the first). Deferred to afterCommit, the
      // same pattern already used below for the completion event and in
      // ChildWorkflowService's 'retry-child' failure policy.
      this.transactionRunner.afterCommit?.(() =>
        this.children.onChildCompleted(parent, persisted),
      );
    }

    this.transactionRunner.afterCommit?.(() =>
      this.publisher.completed(workflow, persisted),
    );

    return {
      state: persisted,
      completed: true,
    };
  }
}
