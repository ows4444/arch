import { Injectable } from '@nestjs/common';

import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';

@Injectable()
export class WorkflowStateValidator {
  validate(state: WorkflowExecutionState): void {
    if (state.stateVersion < 0) {
      throw new WorkflowExecutionError(
        `Workflow '${state.workflowId}' has invalid stateVersion ${state.stateVersion}`,
      );
    }

    switch (state.status) {
      case 'running':
        if (state.waitingSince) {
          throw new WorkflowExecutionError(
            `Running workflow '${state.workflowId}' cannot have waitingSince`,
          );
        }

        if (
          state.executingStep !== undefined &&
          state.stepStartedAt === undefined
        ) {
          throw new WorkflowExecutionError(
            `Running workflow '${state.workflowId}' has executingStep without stepStartedAt`,
          );
        }

        if (
          state.stepStartedAt !== undefined &&
          state.executingStep === undefined
        ) {
          throw new WorkflowExecutionError(
            `Running workflow '${state.workflowId}' has stepStartedAt without executingStep`,
          );
        }

        if (state.completedAt) {
          throw new WorkflowExecutionError(
            `Running workflow '${state.workflowId}' cannot have completedAt`,
          );
        }

        if (state.failedAt) {
          throw new WorkflowExecutionError(
            `Running workflow '${state.workflowId}' cannot have failedAt`,
          );
        }

        break;

      case 'waiting':
        if (!state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Waiting workflow '${state.workflowId}' has no signal`,
          );
        }

        if (!state.waitingSince) {
          throw new WorkflowExecutionError(
            `Waiting workflow '${state.workflowId}' missing waitingSince`,
          );
        }

        if (!state.resumeStep) {
          throw new WorkflowExecutionError(
            `Waiting workflow '${state.workflowId}' has no resume step`,
          );
        }

        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Waiting workflow '${state.workflowId}' is still executing step '${state.executingStep}'`,
          );
        }

        break;

      case 'sleeping':
        if (!state.sleepUntil) {
          throw new WorkflowExecutionError(
            `Sleeping workflow '${state.workflowId}' missing sleepUntil`,
          );
        }

        if (!state.resumeStep) {
          throw new WorkflowExecutionError(
            `Sleeping workflow '${state.workflowId}' has no resume step`,
          );
        }

        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Sleeping workflow '${state.workflowId}' is still executing step '${state.executingStep}'`,
          );
        }

        if (state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Sleeping workflow '${state.workflowId}' cannot also wait for a signal`,
          );
        }

        break;

      case 'waiting-children':
        if (!state.joinId) {
          throw new WorkflowExecutionError(
            `Workflow '${state.workflowId}' waiting on children missing joinId`,
          );
        }

        if (!state.resumeStep) {
          throw new WorkflowExecutionError(
            `Workflow '${state.workflowId}' waiting on children has no resume step`,
          );
        }

        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Workflow '${state.workflowId}' waiting on children is still executing step '${state.executingStep}'`,
          );
        }

        if (state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Workflow '${state.workflowId}' waiting on children cannot also wait for a signal`,
          );
        }

        break;

      case 'cancelled':
        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Cancelled workflow '${state.workflowId}' is still executing`,
          );
        }

        if (state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Cancelled workflow '${state.workflowId}' cannot wait for signal`,
          );
        }

        break;

      case 'completed':
        if (!state.completedAt) {
          throw new WorkflowExecutionError(
            `Completed workflow '${state.workflowId}' missing completedAt`,
          );
        }

        if (state.currentStep) {
          throw new WorkflowExecutionError(
            `Completed workflow '${state.workflowId}' cannot have currentStep`,
          );
        }

        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Completed workflow '${state.workflowId}' is still executing step`,
          );
        }

        if (state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Completed workflow '${state.workflowId}' cannot wait for signal`,
          );
        }

        if (state.failedAt) {
          throw new WorkflowExecutionError(
            `Completed workflow '${state.workflowId}' cannot have failedAt`,
          );
        }

        break;

      case 'failed':
        if (!state.lastFailure) {
          throw new WorkflowExecutionError(
            `Failed workflow '${state.workflowId}' missing lastFailure`,
          );
        }

        if (!state.failedAt) {
          throw new WorkflowExecutionError(
            `Failed workflow '${state.workflowId}' missing failedAt`,
          );
        }

        if (state.executingStep) {
          throw new WorkflowExecutionError(
            `Failed workflow '${state.workflowId}' is still executing`,
          );
        }

        if (state.waitingForSignal) {
          throw new WorkflowExecutionError(
            `Failed workflow '${state.workflowId}' cannot wait for signal`,
          );
        }

        if (!state.failedStep) {
          throw new WorkflowExecutionError(
            `Failed workflow '${state.workflowId}' missing failedStep`,
          );
        }

        break;
    }
  }
}
