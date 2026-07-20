import { Inject, Injectable } from '@nestjs/common';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';
import { WorkflowRetryDelayService } from '../retry/delay.service';
import { WorkflowStateService } from '../state/service';
import { WorkflowStepResultValidator } from '../validation/step-result.validator';
import { WorkflowStepInputValidator } from '../validation/step-input.validator';
import { WorkflowStepPersistenceService } from './step-persistence';
import { WorkflowStepResolver } from './step-resolver';
import { DEFAULT_STEP_TIMEOUT_MS } from '../../constants/workflow.constants';
import {
  WORKFLOW_RETRY_JITTER,
  WORKFLOW_RETRY_SCHEDULER,
} from '../../constants/workflow.tokens';
import { WorkflowFailureError } from '../../errors';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowLeaseService } from '../../infrastructure/lease/lease.service';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import type { WorkflowRetryJitter } from '../../models/workflow-retry-jitter';
import type { WorkflowRetryScheduler } from '../../models/workflow-retry-scheduler';
import { WorkflowSignal } from '../../models/workflow-signal';
import { WorkflowStepResult } from '../../models/workflow-step-result';
import { WorkflowContext } from '../../types/workflow-context';
import { deepFreeze } from '../../shared/utils/deep-freeze';

interface RetryExecutionResult<T> {
  readonly result: T;
  readonly latestState: WorkflowExecutionState;
}

@Injectable()
export class WorkflowStepExecutor {
  constructor(
    private readonly resolver: WorkflowStepResolver,
    private readonly retryDelay: WorkflowRetryDelayService,

    private readonly validator: WorkflowStepResultValidator,
    private readonly inputValidator: WorkflowStepInputValidator,

    @Inject(WORKFLOW_RETRY_JITTER)
    private readonly retryJitter: WorkflowRetryJitter,

    @Inject(WORKFLOW_RETRY_SCHEDULER)
    private readonly retryScheduler: WorkflowRetryScheduler,

    private readonly stateService: WorkflowStateService,
    private readonly leaseService: WorkflowLeaseService,
    private readonly persistence: WorkflowStepPersistenceService,
    private readonly children: ChildWorkflowService,
  ) {}

  async execute(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
    signal?: WorkflowSignal,
  ): Promise<RetryExecutionResult<WorkflowStepResult>> {
    const step = workflow.steps.get(state.currentStep!);

    if (!step) {
      throw new WorkflowExecutionError(`Step '${state.currentStep}' not found`);
    }

    await this.inputValidator.validate(
      state.currentStep!,
      step.metadata.inputSpec,
      state.data,
    );

    const handler = this.resolver.resolve(step.type);

    await this.leaseService.renew(state.workflowId);

    const stopKeepAlive = this.leaseService.keepAlive(state.workflowId);

    const timeoutMs =
      step.metadata.timeoutMs ??
      workflow.metadata.defaultStepTimeoutMs ??
      DEFAULT_STEP_TIMEOUT_MS;

    const buildOperation = (abortSignal: AbortSignal) => {
      const context: WorkflowContext = {
        workflowId: state.workflowId,
        executionId: state.executionId,
        correlationId: state.correlationId,

        stepExecutionKey: `${state.workflowId}:${state.currentStep}:${state.historyCount + 1}`,

        workflowName: state.workflowName,
        currentStep: state.currentStep,

        data: deepFreeze(structuredClone(state.data)),
        signal,
        runtime: {
          abortSignal,
          isCancelled: async () => {
            if (abortSignal.aborted) {
              return true;
            }

            return this.stateService.isCancelled(state.workflowId);
          },
          ...(state.joinId
            ? {
                joinResults: () =>
                  this.children.summarizeJoin(state.workflowId, state.joinId!),
              }
            : {}),
        },
      };

      return handler.execute(context);
    };

    try {
      const execution = await this.executeWithRetry(
        workflow,
        state,
        buildOperation,
        timeoutMs,
      );

      this.validator.validate(workflow, state.currentStep!, execution.result);

      return execution;
    } finally {
      stopKeepAlive();
    }
  }

  private isRetriable(error: unknown): boolean {
    return error instanceof WorkflowFailureError && error.retriable;
  }

  private async executeWithRetry<T>(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
    operation: (abortSignal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<RetryExecutionResult<T>> {
    const retry = workflow.metadata.retries;

    if (!retry) {
      return {
        result: await this.executeStepWithTimeout(operation, timeoutMs),
        latestState: state,
      };
    }

    const maxAttempts = Math.max(1, retry.maxAttempts);

    let attempt = 0;
    let latestState = state;

    while (true) {
      try {
        const result = await this.executeStepWithTimeout(operation, timeoutMs);
        return {
          result,
          latestState,
        };
      } catch (error) {
        if (!this.isRetriable(error)) {
          throw error;
        }

        attempt++;

        if (attempt >= maxAttempts) {
          throw error;
        }

        latestState = await this.persistence.recordRetryAttempt(latestState, {
          step: state.currentStep!,
          startedAt: state.stepStartedAt ?? new Date(),
          completedAt: new Date(),
          durationMs: 0,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });

        const delay = this.retryDelay.compute(retry, attempt);

        await this.retryScheduler.wait(this.retryJitter.apply(delay, attempt));
      }
    }
  }

  private async executeStepWithTimeout<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs = DEFAULT_STEP_TIMEOUT_MS,
  ): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;

    const controller = new AbortController();
    const execution = operation(controller.signal);

    execution.catch(() => {
      // The execution may outlive this attempt's timeout if user code
    });

    try {
      return await Promise.race([
        execution,

        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();

            reject(
              new WorkflowExecutionError(
                `Step execution timeout after ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);

          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
