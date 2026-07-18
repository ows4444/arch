import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowStepResolver } from '../executor/step-resolver';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowHistoryService } from '../../persistence/history.service';
import { WorkflowStepExecution } from '../../models/workflow-step-execution';
import { DEFAULT_COMPENSATION_STEP_TIMEOUT_MS } from '../../constants/workflow.constants';
import { WORKFLOW_METRICS } from '../../constants/workflow.tokens';
import type { WorkflowMetrics } from '../../models/workflow-metrics';

/**
 * `true` when every completed step with a compensation handler was rolled
 * back successfully; `false` when at least one handler threw/timed out (see
 * `WorkflowMetrics.compensationFailed`) or the workflow's compensation
 * strategy was unrecognized/misconfigured — in either case, compensation
 * continues best-effort through the remaining steps rather than aborting.
 */
export type CompensationOutcome = boolean;

@Injectable()
export class WorkflowCompensationService {
  private readonly logger = new Logger(WorkflowCompensationService.name);

  constructor(
    private readonly history: WorkflowHistoryService,
    private readonly resolver: WorkflowStepResolver,

    @Inject(WORKFLOW_METRICS)
    private readonly metrics: WorkflowMetrics,
  ) {}

  async compensate(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<CompensationOutcome> {
    const strategy =
      workflow.metadata.compensation?.strategy ?? 'reverse-order';

    switch (strategy) {
      case 'reverse-order':
        return this.compensateReverseOrder(workflow, state);

      case 'custom':
        return this.compensateCustom(workflow, state);

      default:
        this.logger.warn(
          `Workflow '${workflow.metadata.name}' has unrecognized compensation ` +
            `strategy '${String(strategy)}'; compensation was skipped.`,
        );
        strategy satisfies never;
        return false;
    }
  }

  private async compensateCustom(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<CompensationOutcome> {
    const order = workflow.metadata.compensation?.order;

    if (!order?.length) {
      throw new Error(
        `Workflow '${workflow.metadata.name}' uses custom compensation but no compensation order was provided.`,
      );
    }

    const history = await this.history.findByWorkflowId(state.workflowId);

    const executionMap = new Map(
      history
        .filter((execution) => execution.status === 'completed')
        .map((execution) => [execution.step, execution]),
    );

    const orderedSteps = order
      .map((stepId) => executionMap.get(stepId))
      .filter((execution) => execution !== undefined);

    return this.compensateSteps(workflow, state, orderedSteps);
  }

  private async compensateReverseOrder(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
  ): Promise<CompensationOutcome> {
    const history = await this.history.findByWorkflowId(state.workflowId);

    const orderedSteps = [...history]
      .filter((execution) => execution.status === 'completed')
      .reverse();

    return this.compensateSteps(workflow, state, orderedSteps);
  }

  private async compensateSteps(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
    orderedSteps: readonly WorkflowStepExecution[],
  ): Promise<CompensationOutcome> {
    let fullyCompensated = true;

    for (const execution of orderedSteps) {
      const step = workflow.steps.get(execution.step);

      const compensation = step?.metadata.compensation;

      if (!compensation) {
        continue;
      }

      try {
        const handler = this.resolver.resolveCompensation(compensation.handler);

        await this.compensateWithTimeout(
          (abortSignal) =>
            handler.compensate({
              workflowId: state.workflowId,
              executionId: state.executionId,
              correlationId: state.correlationId,
              workflowName: state.workflowName,
              currentStep: execution.step,
              stepExecutionKey: `${state.workflowId}:${execution.step}`,
              data: state.data,
              runtime: {
                abortSignal,
                isCancelled: () => Promise.resolve(false),
              },
            }),
          DEFAULT_COMPENSATION_STEP_TIMEOUT_MS,
        );
      } catch (error) {
        fullyCompensated = false;

        this.metrics.compensationFailed?.(
          workflow.metadata.name,
          execution.step,
        );

        this.logger.error(
          `Compensation failed for step '${execution.step}'`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }

    return fullyCompensated;
  }

  private async compensateWithTimeout(
    operation: (signal: AbortSignal) => Promise<void>,
    timeoutMs: number,
  ): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;

    const controller = new AbortController();
    const execution = operation(controller.signal);

    execution.catch(() => {
      // The handler may outlive the timeout if it ignores AbortSignal.
    });

    try {
      await Promise.race([
        execution,

        new Promise<void>((_, reject) => {
          timeout = setTimeout(() => {
            controller.abort();

            reject(
              new Error(`Compensation handler timed out after ${timeoutMs}ms`),
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
