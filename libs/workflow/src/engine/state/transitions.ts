import { Injectable } from '@nestjs/common';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowFailure } from '../../models/workflow-failure';
import { WorkflowSignal } from '../../models/workflow-signal';
import { WorkflowStepExecution } from '../../models/workflow-step-execution';
import {
  createWorkflowStepId,
  WorkflowStepId,
} from '../../models/workflow-step-id';

@Injectable()
export class WorkflowStateTransitions {
  private touch(state: WorkflowExecutionState): WorkflowExecutionState {
    return {
      ...state,
      updatedAt: new Date(),
    };
  }

  private clearRecoveryContext(): Pick<
    WorkflowExecutionState,
    'requiresRecovery' | 'recoveryReason' | 'retryAt'
  > {
    return {
      requiresRecovery: false,
      recoveryReason: undefined,
      retryAt: undefined,
    };
  }

  private clearExecutionContext(): Pick<
    WorkflowExecutionState,
    | 'executingStep'
    | 'waitingForSignal'
    | 'waitingSince'
    | 'resumeStep'
    | 'retryAt'
    | 'stepStartedAt'
    | 'requiresRecovery'
  > {
    return {
      executingStep: undefined,
      waitingForSignal: undefined,
      waitingSince: undefined,
      resumeStep: undefined,
      retryAt: undefined,
      stepStartedAt: undefined,
      requiresRecovery: false,
    };
  }

  startStep(
    state: WorkflowExecutionState,
    step: WorkflowStepId,
    startedAt = new Date(),
  ): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearRecoveryContext(),
      currentStep: step,
      executingStep: step,
      stepStartedAt: startedAt,
    });
  }

  incrementStepRetry(state: WorkflowExecutionState): WorkflowExecutionState {
    return this.touch({
      ...state,
      stepRetryCount: (state.stepRetryCount ?? 0) + 1,
    });
  }

  completeWorkflow(state: WorkflowExecutionState): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      stepRetryCount: 0,
      status: 'completed',
      currentStep: undefined,
      completedAt: new Date(),
    });
  }

  cancelWorkflow(state: WorkflowExecutionState): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      status: 'cancelled',
      currentStep: undefined,
    });
  }

  failStep(
    state: WorkflowExecutionState,
    execution: WorkflowStepExecution,
    failure: WorkflowFailure,
  ): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      failedStep: execution.step,
      lastFailure: failure,
    });
  }

  failWorkflow(
    state: WorkflowExecutionState,
    failure: WorkflowFailure,
  ): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      status: 'failed',
      stepRetryCount: 0,

      failedStep: state.executingStep ?? state.currentStep,
      failedAt: new Date(),
      lastFailure: failure,
      failureCount: (state.failureCount ?? 0) + 1,
    });
  }

  resumeFromSignal(state: WorkflowExecutionState): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      status: 'running',
      currentStep: state.resumeStep,
    });
  }

  markRecoverable(
    state: WorkflowExecutionState,
    reason: WorkflowExecutionState['recoveryReason'],
    retryAt?: Date,
  ): WorkflowExecutionState {
    return this.touch({
      ...state,
      stepRetryCount: 0,
      requiresRecovery: true,
      recoveryReason: reason,
      retryAt,
      lastRecoveryAt: new Date(),
    });
  }

  resetForRetry(state: WorkflowExecutionState): WorkflowExecutionState {
    if (state.status !== 'failed') {
      throw new WorkflowExecutionError(
        `resetForRetry called on workflow '${state.workflowId}' with status '${state.status}' — expected 'failed'`,
      );
    }

    if (!state.failedStep) {
      throw new WorkflowExecutionError(
        `resetForRetry called on workflow '${state.workflowId}' but failedStep is not set`,
      );
    }

    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      status: 'running',
      currentStep: createWorkflowStepId(state.failedStep),
      stepRetryCount: 0,
      failedAt: undefined,
    });
  }

  scheduleRetry(
    state: WorkflowExecutionState,
    retryAt: Date,
  ): WorkflowExecutionState {
    const reset = this.resetForRetry(state);

    return this.touch({
      ...reset,
      requiresRecovery: true,
      recoveryReason: 'unknown',
      retryAt,
    });
  }

  incrementRecoveryAttempts(
    state: WorkflowExecutionState,
  ): WorkflowExecutionState {
    return this.touch({
      ...state,
      recoveryAttempts: (state.recoveryAttempts ?? 0) + 1,
      lastRecoveryAt: new Date(),
    });
  }

  clearRecovery(state: WorkflowExecutionState): WorkflowExecutionState {
    return this.touch({
      ...state,
      ...this.clearRecoveryContext(),
    });
  }

  completeStep(
    state: WorkflowExecutionState,
    _execution: WorkflowStepExecution,
    nextStep?: WorkflowStepId,
    waitForSignal?: WorkflowSignal,
    data?: object,
  ): WorkflowExecutionState {
    const mergedData =
      data === undefined
        ? state.data
        : {
            ...state.data,
            ...data,
          };

    if (waitForSignal) {
      return this.touch({
        ...state,
        ...this.clearExecutionContext(),
        stepRetryCount: 0,
        status: 'waiting',
        data: mergedData,
        waitingForSignal: waitForSignal,
        waitingSince: new Date(),
        resumeStep: nextStep,
        historyCount: state.historyCount + 1,
        iteration: state.iteration + 1,
      });
    }

    return this.touch({
      ...state,
      ...this.clearExecutionContext(),
      stepRetryCount: 0,
      data: mergedData,
      currentStep: nextStep,
      historyCount: state.historyCount + 1,
      iteration: state.iteration + 1,
    });
  }
}
