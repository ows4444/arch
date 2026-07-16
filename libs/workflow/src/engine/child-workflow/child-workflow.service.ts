import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { WorkflowExecutor } from '../executor/executor';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionResult } from '../../models/workflow-execution-result';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowStateService } from '../state/service';
import { WorkflowCompensationService } from '../compensation/service';
import { WorkflowRegistry } from '../registry/registry';

import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowRetryDelayService } from '../retry/delay.service';

import { DEFAULT_CHILD_RETRY_DELAY_MS } from '../../constants/workflow.constants';
import {
  WORKFLOW_PARENT_FAILURE_HANDLER,
  WORKFLOW_RETRY_JITTER,
  WORKFLOW_RETRY_SCHEDULER,
} from '../../constants/workflow.tokens';
import { WorkflowChildMetadata } from '../../definition/workflow-child-metadata';
import { NonRetriableWorkflowError } from '../../errors';
import { WorkflowError } from '../../errors/workflow.errors';
import type { WorkflowParentFailureHandler } from '../../ports/workflow-parent-failure-handler';
import type { WorkflowRetryJitter } from '../../models/workflow-retry-jitter';
import type { WorkflowRetryScheduler } from '../../models/workflow-retry-scheduler';

@Injectable()
export class ChildWorkflowService {
  private readonly logger = new Logger(ChildWorkflowService.name);
  constructor(
    @Inject(forwardRef(() => WorkflowExecutor))
    private readonly executor: WorkflowExecutor,
    private readonly stateService: WorkflowStateService,
    private readonly compensation: WorkflowCompensationService,
    private readonly registry: WorkflowRegistry,
    private readonly transitions: WorkflowStateTransitions,
    private readonly retryDelay: WorkflowRetryDelayService,

    @Inject(WORKFLOW_PARENT_FAILURE_HANDLER)
    private readonly parentFailureHandler: WorkflowParentFailureHandler,

    @Inject(WORKFLOW_RETRY_JITTER)
    private readonly retryJitter: WorkflowRetryJitter,

    @Inject(WORKFLOW_RETRY_SCHEDULER)
    private readonly retryScheduler: WorkflowRetryScheduler,
  ) {}

  private async retryChild(
    definition: WorkflowChildMetadata,
    child: WorkflowExecutionState,
  ): Promise<void> {
    if (child.status !== 'failed' || child.lastFailure?.retriable === false) {
      this.logger.warn(
        `'retry-child' policy skipped: child '${child.workflowId}' ` +
          `failure is non-retriable or not in failed status`,
      );
      return;
    }

    const maxRetries = definition.maxRetries ?? 1;
    const attempts = child.failureCount ?? 0;

    if (attempts >= maxRetries) {
      this.logger.warn(
        `'retry-child' policy exhausted for child '${child.workflowName}' ` +
          `(${child.workflowId}): failureCount=${attempts} >= maxRetries=${maxRetries}. ` +
          `Child will remain in failed status.`,
      );
      return;
    }

    try {
      const attempt = Math.max(1, attempts);

      const delay = this.retryDelay.compute(
        {
          maxAttempts: maxRetries,
          strategy: 'exponential',
          delayMs: DEFAULT_CHILD_RETRY_DELAY_MS,
        },
        attempt,
      );

      await this.retryScheduler.wait(this.retryJitter.apply(delay, attempt));

      const reset = this.transitions.resetForRetry(child);
      await this.stateService.save(child, reset);
      await this.executor.resume(child.workflowId);

      this.logger.debug(
        `'retry-child' reset and resumed child '${child.workflowName}' ` +
          `(${child.workflowId}): attempt=${attempts + 1}/${maxRetries}`,
      );
    } catch (error) {
      if (error instanceof WorkflowError) {
        this.logger.warn(
          `'retry-child' could not resume child '${child.workflowName}' ` +
            `(${child.workflowId}): ${error.message}`,
        );
        return;
      }

      this.logger.error(
        `'retry-child' policy failed to resume child '${child.workflowName}' ` +
          `(${child.workflowId})`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private getManagedChild(
    parent: WorkflowExecutionState,
    child: WorkflowExecutionState,
  ):
    | {
        workflow: RegisteredWorkflow;
        definition: WorkflowChildMetadata;
      }
    | undefined {
    const workflow = this.registry.get(
      parent.workflowName,
      parent.workflowVersion,
    );

    const definition = this.findDefinition(workflow, child);

    if (!definition) {
      return;
    }

    return {
      workflow,
      definition,
    };
  }

  private async failParent(
    parent: WorkflowExecutionState,
    child: WorkflowExecutionState,
    compensation: boolean,
  ): Promise<void> {
    const reason = child.lastFailure?.message ?? 'Child workflow failed';

    await this.parentFailureHandler.failExecution(
      parent,
      new NonRetriableWorkflowError(
        compensation
          ? `Child workflow '${child.workflowName}' failed (compensation triggered): ${reason}`
          : `Child workflow '${child.workflowName}' failed: ${reason}`,
      ),
    );
  }

  private isTerminal(state: WorkflowExecutionState): boolean {
    return (
      state.status === 'completed' ||
      state.status === 'cancelled' ||
      state.status === 'failed'
    );
  }

  private resolveRegisteredChild(
    definition: WorkflowChildMetadata,
  ): RegisteredWorkflow | undefined {
    return this.registry
      .getAll()
      .find((candidate) => candidate.workflowType === definition.workflow);
  }

  findDefinition(
    workflow: RegisteredWorkflow,
    child: WorkflowExecutionState,
  ): WorkflowChildMetadata | undefined {
    return workflow.metadata.childWorkflows?.find((definition) => {
      const registered = this.resolveRegisteredChild(definition);

      return (
        registered?.metadata.name === child.workflowName &&
        registered.metadata.version === child.workflowVersion
      );
    });
  }

  isManagedChild(
    workflow: RegisteredWorkflow,
    child: WorkflowExecutionState,
  ): boolean {
    return this.findDefinition(workflow, child) !== undefined;
  }

  async findChildren(
    parentWorkflowId: string,
  ): Promise<WorkflowExecutionState[]> {
    return this.stateService.findByParentWorkflowId(parentWorkflowId);
  }

  async findParent(
    state: WorkflowExecutionState,
  ): Promise<WorkflowExecutionState | null> {
    if (!state.parentWorkflowId) {
      return null;
    }

    return this.stateService.load(state.parentWorkflowId);
  }

  onChildCompleted(
    parent: WorkflowExecutionState,
    child: WorkflowExecutionState,
  ): Promise<void> {
    const managed = this.getManagedChild(parent, child);

    if (!managed) {
      return Promise.resolve();
    }

    this.logger.debug(
      `Child workflow '${child.workflowName}' (${child.workflowId}) completed ` +
        `for parent '${parent.workflowName}' (${parent.workflowId})`,
    );

    return Promise.resolve();
  }

  async onChildFailed(
    parent: WorkflowExecutionState,
    child: WorkflowExecutionState,
  ): Promise<void> {
    const managed = this.getManagedChild(parent, child);

    if (!managed) {
      return;
    }

    const { workflow: parentWorkflow, definition } = managed;

    this.logger.warn(
      `Child workflow '${child.workflowName}' (${child.workflowId}) failed ` +
        `for parent '${parent.workflowName}' (${parent.workflowId}) ` +
        `— applying policy '${definition.failurePolicy}'`,
    );

    switch (definition.failurePolicy) {
      case 'ignore':
        return;

      case 'fail-parent': {
        if (this.isTerminal(parent)) {
          this.logger.warn(
            `Cannot apply 'fail-parent' policy: parent '${parent.workflowId}' ` +
              `is already in terminal status '${parent.status}'`,
          );
          return;
        }

        await this.failParent(parent, child, false);
        return;
      }

      case 'retry-child': {
        await this.retryChild(definition, child);

        return;
      }

      case 'compensate-parent': {
        if (this.isTerminal(parent)) {
          this.logger.warn(
            `Cannot apply 'compensate-parent' policy: parent '${parent.workflowId}' ` +
              `is already in terminal status '${parent.status}'`,
          );
          return;
        }

        await this.compensation.compensate(parentWorkflow, parent);
        await this.failParent(parent, child, true);
        return;
      }

      default:
        definition.failurePolicy satisfies never;
    }
  }

  async startChildren(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    const children = workflow.metadata.childWorkflows;

    if (!children?.length) {
      return;
    }

    const results = await Promise.allSettled(
      children.map(async (child) => {
        const registered = this.resolveRegisteredChild(child);

        if (!registered) {
          throw new NonRetriableWorkflowError(
            `Child workflow class for '${workflow.metadata.name}' is not registered`,
          );
        }

        return this.executor.execute(
          registered.metadata.name,
          {},
          {
            correlationId: state.correlationId,
            parentWorkflowId: state.workflowId,
            parentExecutionId: state.executionId,
          },
        );
      }),
    );

    const failures = results
      .map((result, i) => ({ result, child: children[i] }))
      .filter(
        (
          x,
        ): x is {
          result: PromiseRejectedResult;
          child: WorkflowChildMetadata;
        } => x.result.status === 'rejected',
      );

    if (failures.length === 0) {
      return;
    }

    const started = results.filter(
      (result): result is PromiseFulfilledResult<WorkflowExecutionResult> =>
        result.status === 'fulfilled',
    );

    if (started.length > 0) {
      await Promise.allSettled(
        started.map(({ value }) => this.executor.cancel(value.workflowId)),
      );
    }

    this.logger.error(
      `Failed to start ${failures.length}/${children.length} child workflow(s) ` +
        `for parent '${state.workflowId}': ` +
        failures
          .map(
            ({ child, result }) =>
              `${child.workflow.name} (${
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason)
              })`,
          )
          .join('; ') +
        (started.length > 0
          ? `. Cancelled ${started.length} already-started sibling child workflow(s).`
          : ''),
    );

    await this.parentFailureHandler.failExecution(
      state,
      new NonRetriableWorkflowError(
        `Failed to start ${failures.length} of ${children.length} declared child workflow(s).`,
      ),
    );
  }

  async cancelChildren(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<void> {
    const children = workflow.metadata.childWorkflows;

    if (!children?.length) {
      return;
    }

    const executions = await this.executor.findByParentWorkflowId(
      state.workflowId,
    );

    const toCancel = executions.filter((execution) => {
      const definition = children.find((x) => {
        const registered = this.resolveRegisteredChild(x);

        return registered?.metadata.name === execution.workflowName;
      });

      if (!definition || definition.cancellationPolicy !== 'propagate') {
        return false;
      }

      return (
        execution.status !== 'completed' &&
        execution.status !== 'cancelled' &&
        execution.status !== 'failed'
      );
    });

    const results = await Promise.allSettled(
      toCancel.map((execution) => this.executor.cancel(execution.workflowId)),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === 'rejected') {
        this.logger.error(
          `Failed to cancel child workflow '${toCancel[index]!.workflowId}' ` +
            `for parent '${state.workflowId}'`,
          result.reason instanceof Error
            ? result.reason.stack
            : String(result.reason),
        );
      }
    }
  }
}
