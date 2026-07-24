import { WorkflowExecutionState } from '../../../../models/workflow-execution-state';
import { createWorkflowStepId } from '../../../../models/workflow-step-id';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { WorkflowStateEntity } from '../entities/workflow-state.entity';

export class WorkflowStateMapper {
  static toPersistence(
    state: WorkflowExecutionState,
  ): QueryDeepPartialEntity<WorkflowStateEntity> {
    return {
      workflowId: state.workflowId,
      executionId: state.executionId,
      parentWorkflowId: state.parentWorkflowId ?? null,
      parentExecutionId: state.parentExecutionId ?? null,
      workflowName: state.workflowName,
      workflowVersion: state.workflowVersion,
      status: state.status,
      currentStep: state.currentStep ? String(state.currentStep) : null,
      failedStep: state.failedStep ?? null,
      lastFailure: state.lastFailure ?? null,
      recoveryReason: state.recoveryReason ?? null,
      data: state.data as QueryDeepPartialEntity<Record<string, unknown>>,
      historyCount: state.historyCount,
      correlationId: state.correlationId,
      executingStep: state.executingStep ? String(state.executingStep) : null,
      resumeStep: state.resumeStep ? String(state.resumeStep) : null,
      stepRetryCount: state.stepRetryCount ?? null,
      waitingForSignal:
        (state.waitingForSignal as
          | QueryDeepPartialEntity<WorkflowStateEntity>['waitingForSignal']
          | undefined) ?? null,
      waitingSince: state.waitingSince ?? null,
      sleepUntil: state.sleepUntil ?? null,
      joinId: state.joinId ?? null,
      joinPolicy:
        (state.joinPolicy as
          | QueryDeepPartialEntity<WorkflowStateEntity>['joinPolicy']
          | undefined) ?? null,
      iteration: state.iteration,
      failureCount: state.failureCount ?? null,
      requiresRecovery: state.requiresRecovery ?? null,
      pendingEffect:
        (state.pendingEffect as
          | QueryDeepPartialEntity<WorkflowStateEntity>['pendingEffect']
          | undefined) ?? null,
      recoveryAttempts: state.recoveryAttempts ?? null,
      retryAt: state.retryAt ?? null,
      leaseOwner: state.leaseOwner ?? null,
      leaseExpiresAt: state.leaseExpiresAt ?? null,
      lastRecoveryAt: state.lastRecoveryAt ?? null,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      completedAt: state.completedAt ?? null,
      failedAt: state.failedAt ?? null,
      stepStartedAt: state.stepStartedAt ?? null,
      stateVersion: state.stateVersion,
    };
  }

  static toDomain(entity: WorkflowStateEntity): WorkflowExecutionState {
    return {
      workflowId: entity.workflowId,
      executionId: entity.executionId,
      parentWorkflowId: entity.parentWorkflowId ?? undefined,
      parentExecutionId: entity.parentExecutionId ?? undefined,
      workflowName: entity.workflowName,
      workflowVersion: entity.workflowVersion,
      status: entity.status,

      ...(entity.currentStep
        ? { currentStep: createWorkflowStepId(entity.currentStep) }
        : {}),
      failedStep: entity.failedStep ?? undefined,
      lastFailure: entity.lastFailure ?? undefined,
      recoveryReason: entity.recoveryReason ?? undefined,
      data: entity.data,
      historyCount: entity.historyCount,
      correlationId: entity.correlationId,
      ...(entity.executingStep
        ? { executingStep: createWorkflowStepId(entity.executingStep) }
        : {}),

      ...(entity.resumeStep
        ? { resumeStep: createWorkflowStepId(entity.resumeStep) }
        : {}),

      stepRetryCount: entity.stepRetryCount ?? undefined,
      waitingForSignal: entity.waitingForSignal ?? undefined,
      waitingSince: entity.waitingSince ?? undefined,
      sleepUntil: entity.sleepUntil ?? undefined,
      joinId: entity.joinId ?? undefined,
      joinPolicy: entity.joinPolicy ?? undefined,
      iteration: entity.iteration,
      failureCount: entity.failureCount ?? undefined,
      requiresRecovery: entity.requiresRecovery ?? undefined,
      pendingEffect: entity.pendingEffect ?? undefined,
      recoveryAttempts: entity.recoveryAttempts ?? undefined,
      leaseOwner: entity.leaseOwner ?? undefined,
      leaseExpiresAt: entity.leaseExpiresAt ?? undefined,
      lastRecoveryAt: entity.lastRecoveryAt ?? undefined,
      retryAt: entity.retryAt ?? undefined,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      completedAt: entity.completedAt ?? undefined,
      failedAt: entity.failedAt ?? undefined,
      stepStartedAt: entity.stepStartedAt ?? undefined,
      stateVersion: entity.stateVersion,
    };
  }
}
