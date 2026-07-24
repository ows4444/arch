import { Inject, Injectable } from '@nestjs/common';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowStateFactory } from '../state/factory';
import { WorkflowStateService } from '../state/service';
import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowLifecyclePublisher } from './lifecycle.publisher';
import { WORKFLOW_TRANSACTION_RUNNER } from '../../constants/workflow.tokens';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowLogger } from '../../observability/logger';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { WorkflowRecoveryService } from '../retry/recovery.service';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';
import { WorkflowExecutionOptions } from '../executor/executor';
import { WorkflowPersistenceService } from '../../persistence/workflow-persistence.service';
import { afterCommitOrNow } from '../../shared/utils/after-commit-or-now';

@Injectable()
export class WorkflowLifecycleService {
  constructor(
    private readonly registry: WorkflowRegistry,
    private readonly stateFactory: WorkflowStateFactory,
    private readonly stateService: WorkflowStateService,
    private readonly transitions: WorkflowStateTransitions,
    private readonly publisher: WorkflowLifecyclePublisher,
    private readonly children: ChildWorkflowService,
    private readonly recovery: WorkflowRecoveryService,
    private readonly persistence: WorkflowPersistenceService,
    private readonly logger: WorkflowLogger,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async create(
    workflowName: string,
    initialData: Record<string, unknown>,
    options?: WorkflowExecutionOptions,
  ): Promise<{
    workflow: RegisteredWorkflow;
    state: WorkflowExecutionState;
  }> {
    const workflow = this.registry.resolve(
      workflowName,
      options?.workflowVersion,
    );

    const state = {
      ...this.stateFactory.create(workflow, initialData, options),
      pendingEffect: { type: 'start-children' as const },
    };

    await this.stateService.insert(state);
    this.logger.started(state);

    await afterCommitOrNow(this.transactionRunner, async () => {
      await this.publisher.started(workflow, state);
      await this.children.startChildren(workflow, state);
      await this.stateService.clearPendingEffect(state.workflowId);
    });

    return {
      workflow,
      state,
    };
  }

  async resume(workflowId: string): Promise<{
    workflow: RegisteredWorkflow;
    state: WorkflowExecutionState;
  }> {
    const state = await this.stateService.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    if (state.status === 'waiting') {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' is waiting for a signal`,
      );
    }

    if (state.status !== 'running') {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' cannot be resumed from status '${state.status}'`,
      );
    }

    if (state.retryAt && state.retryAt.getTime() > Date.now()) {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' cannot be resumed before its scheduled retry at ${state.retryAt.toISOString()}`,
      );
    }

    const workflow = this.registry.get(
      state.workflowName,
      state.workflowVersion,
    );

    if (state.requiresRecovery) {
      await this.recovery.validateRecoverable(state);
    }

    const resumed = state.requiresRecovery
      ? ((await this.persistence.recoverSnapshot(state)) ??
        (await this.stateService.save(
          state,
          this.transitions.clearRecovery(
            this.transitions.incrementRecoveryAttempts(state),
          ),
        )))
      : state;

    if (state.requiresRecovery) {
      this.logger.recovered(resumed);
    }

    return {
      workflow,
      state: resumed,
    };
  }
}
