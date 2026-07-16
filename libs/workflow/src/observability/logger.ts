import { Inject, Injectable, Logger } from '@nestjs/common';
import { WORKFLOW_METRICS } from '../constants/workflow.tokens';
import { WorkflowExecutionState } from '../models/workflow-execution-state';
import type { WorkflowMetrics } from '../models/workflow-metrics';
import { WorkflowStepExecution } from '../models/workflow-step-execution';
import { WorkflowRegistry } from '../engine/registry/registry';

@Injectable()
export class WorkflowLogger {
  constructor(
    private readonly registry: WorkflowRegistry,

    @Inject(WORKFLOW_METRICS)
    private readonly metrics: WorkflowMetrics,
  ) {}

  private metricsEnabled(workflowName: string, version?: number): boolean {
    const workflow =
      version === undefined
        ? this.registry.getLatest(workflowName)
        : this.registry.get(workflowName, version);

    return workflow.metadata.observability?.metrics !== false;
  }

  private readonly logger = new Logger('Workflow');

  started(state: WorkflowExecutionState): void {
    this.logger.log(
      `Started workflow=${state.workflowName} workflowId=${state.workflowId} executionId=${state.executionId} correlationId=${state.correlationId}`,
    );

    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.workflowStarted(state.workflowName);
    }
  }

  deprecatedStep(
    workflowName: string,
    step: string,
    replacement?: string,
  ): void {
    this.logger.warn(
      replacement
        ? `Workflow '${workflowName}' executed deprecated step '${step}'. Replacement: '${replacement}'.`
        : `Workflow '${workflowName}' executed deprecated step '${step}'.`,
    );
  }

  completed(state: WorkflowExecutionState): void {
    this.logger.log(
      `Completed workflow=${state.workflowName} workflowId=${state.workflowId}`,
    );
    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.workflowCompleted(state.workflowName);
    }
  }

  failed(state: WorkflowExecutionState, error: unknown): void {
    this.logger.error(
      `Failed workflow=${state.workflowName} workflowId=${state.workflowId}`,
      error instanceof Error ? error.stack : String(error),
    );
    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.workflowFailed(state.workflowName);
    }
  }

  recovered(state: WorkflowExecutionState): void {
    this.logger.log(
      `Recovered workflow=${state.workflowName} workflowId=${state.workflowId}`,
    );

    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.workflowRecovered(state.workflowName);
    }
  }

  stepStarted(state: WorkflowExecutionState): void {
    this.logger.debug(
      `Step started workflowId=${state.workflowId} step=${state.currentStep}`,
    );
    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.stepStarted(state.workflowName, state.currentStep!);
    }
  }

  stepCompleted(
    state: WorkflowExecutionState,
    execution: WorkflowStepExecution,
  ): void {
    this.logger.debug(
      `Step completed workflowId=${state.workflowId} step=${execution.step} duration=${execution.durationMs ?? 0}ms`,
    );
    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.stepCompleted(
        state.workflowName,
        execution.step,
        execution.durationMs ?? 0,
      );
    }
  }

  cancelled(state: WorkflowExecutionState): void {
    this.logger.log(
      `Cancelled workflow=${state.workflowName} workflowId=${state.workflowId}`,
    );

    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.workflowCancelled(state.workflowName);
    }
  }

  signalReceived(
    workflowName: string,
    workflowId: string,
    signalName: string,
    signalId: string,
  ): void {
    this.logger.debug(
      `Signal received workflowId=${workflowId} signal=${signalName} signalId=${signalId}`,
    );
    if (this.metricsEnabled(workflowName)) {
      this.metrics.signalReceived(workflowName);
    }
  }

  retryScheduled(state: WorkflowExecutionState, retryAt: Date): void {
    this.logger.debug(
      `Retry scheduled workflow=${state.workflowName} workflowId=${state.workflowId} retryAt=${retryAt.toISOString()}`,
    );

    if (this.metricsEnabled(state.workflowName, state.workflowVersion)) {
      this.metrics.retryScheduled(state.workflowName);
    }
  }
}
