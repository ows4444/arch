import { Inject, Injectable } from '@nestjs/common';

import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { WORKFLOW_TRANSACTION_RUNNER } from '../../constants/workflow.tokens';
import { WorkflowStateService } from '../state/service';
import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowStepExecution } from '../../models/workflow-step-execution';
import { WorkflowStepId } from '../../models/workflow-step-id';
import { WorkflowStepResult } from '../../models/workflow-step-result';
import { WorkflowHistoryService } from '../../persistence/history.service';
import { WorkflowPersistenceService } from '../../persistence/workflow-persistence.service';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';

@Injectable()
export class WorkflowStepPersistenceService {
  constructor(
    private readonly history: WorkflowHistoryService,
    private readonly transitions: WorkflowStateTransitions,
    private readonly stateService: WorkflowStateService,
    private readonly persistence: WorkflowPersistenceService,
    private readonly children: ChildWorkflowService,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async startStep(
    previous: WorkflowExecutionState,
    step: WorkflowStepId,
    startedAt: Date,
  ): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(async () => {
      const next = this.transitions.startStep(previous, step, startedAt);
      const persisted = await this.stateService.save(previous, next);

      await this.history.append(persisted.workflowId, {
        step,
        startedAt,
        status: 'started',
      });

      return persisted;
    });
  }

  async completeStep(
    workflow: RegisteredWorkflow,
    previous: WorkflowExecutionState,
    execution: WorkflowStepExecution,
    result: WorkflowStepResult,
  ): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(async () => {
      await this.history.append(previous.workflowId, execution);

      const sleepUntil =
        result.sleepUntil ??
        (result.sleepMs !== undefined
          ? new Date(Date.now() + result.sleepMs)
          : undefined);

      const join = result.spawnChildren?.length
        ? {
            joinId: `${previous.workflowId}:${execution.step}:${previous.historyCount + 1}`,
            joinPolicy: result.joinPolicy ?? 'all',
          }
        : undefined;

      const next = this.transitions.completeStep(
        previous,
        execution,
        result.nextStep,
        result.waitForSignal,
        result.data,
        sleepUntil,
        join,
      );

      const persisted = await this.stateService.save(previous, next);

      await this.persistence.snapshot(workflow, persisted);

      if (join && result.spawnChildren?.length) {
        const spawnSpecs = result.spawnChildren;

        this.transactionRunner.afterCommit?.(() =>
          this.children.spawnFanOut(workflow, persisted, spawnSpecs),
        );
      }

      return persisted;
    });
  }

  async recordStepAttempt(
    workflowId: string,
    execution: WorkflowStepExecution,
  ): Promise<void> {
    await this.history.append(workflowId, execution);
  }

  async recordRetryAttempt(
    previous: WorkflowExecutionState,
    execution: WorkflowStepExecution,
  ): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(async () => {
      await this.history.append(previous.workflowId, execution);

      const next = this.transitions.incrementStepRetry(previous);

      return this.stateService.save(previous, next);
    });
  }

  async appendFailure(
    workflowId: string,
    execution: WorkflowStepExecution,
  ): Promise<void> {
    await this.history.append(workflowId, execution);
  }
}
