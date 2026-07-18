import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowCompensationService } from '../compensation/service';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowRetryService } from '../retry/retry.service';
import { WorkflowStateService } from '../state/service';
import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowLifecyclePublisher } from './lifecycle.publisher';
import { WORKFLOW_TRANSACTION_RUNNER } from '../../constants/workflow.tokens';
import { WorkflowFailureError } from '../../errors';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowFailure } from '../../models/workflow-failure';
import { WorkflowLogger } from '../../observability/logger';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { WorkflowStepPersistenceService } from '../executor/step-persistence';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';

@Injectable()
export class WorkflowFailureService {
  private readonly opsLogger = new Logger(WorkflowFailureService.name);

  constructor(
    private readonly persistence: WorkflowStepPersistenceService,
    private readonly transitions: WorkflowStateTransitions,
    private readonly stateService: WorkflowStateService,
    private readonly retryService: WorkflowRetryService,
    private readonly compensation: WorkflowCompensationService,
    private readonly registry: WorkflowRegistry,
    private readonly publisher: WorkflowLifecyclePublisher,
    private readonly logger: WorkflowLogger,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,

    @Inject(forwardRef(() => ChildWorkflowService))
    private readonly children: ChildWorkflowService,
  ) {}

  serialize(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async handleFailure(
    state: WorkflowExecutionState,
    error: unknown,
  ): Promise<void> {
    if (!state.executingStep && !state.currentStep) {
      return;
    }

    await this.failExecution(state, error);
  }

  toFailure(error: unknown): WorkflowFailure {
    if (error instanceof WorkflowFailureError) {
      return {
        code: error.constructor.name,
        message: error.message,
        retriable: error.retriable,
      };
    }

    if (error instanceof WorkflowExecutionError) {
      return {
        code: 'WORKFLOW_EXECUTION_ERROR',
        message: error.message,
        retriable: false,
      };
    }

    return {
      code: 'UNKNOWN',
      message: this.serialize(error),
      retriable: false,
    };
  }

  async failExecution(
    state: WorkflowExecutionState,
    error: unknown,
  ): Promise<void> {
    const failedAt = new Date();

    const failedStep = state.executingStep ?? state.currentStep;

    if (!failedStep) {
      return;
    }

    const persisted = await this.transactionRunner.executeOrJoin(async () => {
      await this.persistence.appendFailure(state.workflowId, {
        step: failedStep,
        startedAt: state.stepStartedAt ?? failedAt,
        completedAt: failedAt,
        durationMs:
          failedAt.getTime() - (state.stepStartedAt ?? failedAt).getTime(),
        status: 'failed',
        error: this.serialize(error),
      });

      const failedState = this.transitions.failWorkflow(
        state,
        this.toFailure(error),
      );

      return this.stateService.save(state, failedState);
    });

    this.logger.failed(persisted, error);

    const latest =
      (await this.stateService.load(persisted.workflowId)) ?? persisted;

    const parent = await this.children.findParent(latest);

    if (parent) {
      await this.children.onChildFailed(parent, latest);
    }

    const workflow = this.registry.get(
      latest.workflowName,
      latest.workflowVersion,
    );

    this.transactionRunner.afterCommit?.(async () => {
      try {
        await this.publisher.failed(workflow, latest);
      } catch (publishError) {
        this.opsLogger.error(
          `Failed to publish the 'failed' lifecycle event for workflow=${latest.workflowName} workflowId=${latest.workflowId} — the workflow's failure was still recorded; only the event notification was lost.`,
          publishError instanceof Error
            ? publishError.stack
            : String(publishError),
        );
      }

      try {
        const retry = workflow.metadata.retries;

        if (retry && this.retryService.canRetry(latest, retry.maxAttempts)) {
          await this.retryService.retry(latest, retry);
          return;
        }

        if (workflow.metadata.compensation?.enabled) {
          const fullyCompensated = await this.compensation.compensate(
            workflow,
            latest,
          );

          if (!fullyCompensated) {
            this.opsLogger.error(
              `Compensation did not fully complete for workflow=${latest.workflowName} workflowId=${latest.workflowId} — one or more steps' compensation handlers failed (see prior 'Compensation failed for step' errors) and will require manual intervention.`,
            );
          }
        }
      } catch (schedulingError) {
        this.opsLogger.error(
          `Failed to schedule retry/compensation after workflow failure for workflow=${latest.workflowName} workflowId=${latest.workflowId} — the workflow is 'failed' with no retry or compensation scheduled and will require manual intervention.`,
          schedulingError instanceof Error
            ? schedulingError.stack
            : String(schedulingError),
        );
      }
    });
  }
}
