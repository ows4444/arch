import { Inject, Injectable } from '@nestjs/common';

import {
  WORKFLOW_IDEMPOTENCY_STORE,
  WORKFLOW_STATE_STORE,
  WORKFLOW_TRANSACTION_RUNNER,
} from '../../constants/workflow.tokens';

import { WorkflowLifecyclePublisher } from '../lifecycle/lifecycle.publisher';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowSignalService } from '../signals/signal.service';
import { WorkflowStateTransitions } from './transitions';
import { WorkflowStateValidator } from './validator';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowLeaseService } from '../../infrastructure/lease/lease.service';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowLogger } from '../../observability/logger';
import { WorkflowHistoryService } from '../../persistence/history.service';
import type { WorkflowIdempotencyStore } from '../../ports/workflow-idempotency-store';
import type { WorkflowStateStore } from '../../ports/workflow-state-store';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';

@Injectable()
export class WorkflowStateService {
  constructor(
    @Inject(WORKFLOW_STATE_STORE)
    private readonly store: WorkflowStateStore,

    private readonly validator: WorkflowStateValidator,
    private readonly registry: WorkflowRegistry,
    private readonly publisher: WorkflowLifecyclePublisher,
    private readonly logger: WorkflowLogger,
    private readonly transitions: WorkflowStateTransitions,

    private readonly history: WorkflowHistoryService,
    private readonly signals: WorkflowSignalService,
    private readonly leaseService: WorkflowLeaseService,

    @Inject(WORKFLOW_IDEMPOTENCY_STORE)
    private readonly idempotency: WorkflowIdempotencyStore,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async isCancelled(workflowId: string): Promise<boolean> {
    const state = await this.load(workflowId);

    return state?.status === 'cancelled' || state?.status === 'failed';
  }

  async insert(state: WorkflowExecutionState): Promise<void> {
    this.validator.validate(state);

    return this.transactionRunner.executeOrJoin(() => this.store.insert(state));
  }

  async findByCorrelationId(
    correlationId: string,
  ): Promise<WorkflowExecutionState[]> {
    return this.store.findByCorrelationId(correlationId);
  }

  async findActive(workflowName?: string): Promise<WorkflowExecutionState[]> {
    return this.store.findActive(workflowName);
  }

  async load(workflowId: string): Promise<WorkflowExecutionState | null> {
    return this.store.load(workflowId);
  }

  async reload(state: WorkflowExecutionState): Promise<WorkflowExecutionState> {
    const latest = await this.load(state.workflowId);

    if (!latest) {
      throw new WorkflowExecutionError(
        `Workflow '${state.workflowId}' not found`,
      );
    }

    return latest;
  }

  async cancel(
    workflowId: string,
    expired = false,
  ): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(() =>
      this.cancelInternal(workflowId, expired),
    );
  }

  private async cancelInternal(
    workflowId: string,
    expired: boolean,
  ): Promise<WorkflowExecutionState> {
    const state = await this.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    const cancelled = this.transitions.cancelWorkflow(state);

    const persisted = await this.save(state, cancelled);

    this.logger.cancelled(persisted);

    const workflow = this.registry.get(
      persisted.workflowName,
      persisted.workflowVersion,
    );

    this.transactionRunner.afterCommit?.(async () => {
      await (expired
        ? this.publisher.expired(workflow, persisted)
        : this.publisher.cancelled(workflow, persisted));
    });

    return persisted;
  }

  async wake(workflowId: string): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(() =>
      this.wakeInternal(workflowId),
    );
  }

  private async wakeInternal(
    workflowId: string,
  ): Promise<WorkflowExecutionState> {
    const state = await this.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    if (state.status !== 'sleeping') {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' cannot be woken from status '${state.status}'`,
      );
    }

    const resumed = this.transitions.resumeFromSleep(state);

    return this.save(state, resumed);
  }

  async resumeJoin(workflowId: string): Promise<WorkflowExecutionState> {
    return this.transactionRunner.executeOrJoin(() =>
      this.resumeJoinInternal(workflowId),
    );
  }

  private async resumeJoinInternal(
    workflowId: string,
  ): Promise<WorkflowExecutionState> {
    const state = await this.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    if (state.status !== 'waiting-children') {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' cannot resume a join from status '${state.status}'`,
      );
    }

    const resumed = this.transitions.resumeFromJoin(state);

    return this.save(state, resumed);
  }

  async findCompleted(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs?: number,
    limit?: number,
  ): Promise<WorkflowExecutionState[]> {
    return (
      (await this.store.findCompleted?.(
        workflowName,
        workflowVersion,
        olderThanMs,
        limit,
      )) ?? []
    );
  }

  async save(
    previous: WorkflowExecutionState,
    next: WorkflowExecutionState,
  ): Promise<WorkflowExecutionState> {
    const versioned: WorkflowExecutionState = {
      ...next,
      stateVersion: previous.stateVersion + 1,
      updatedAt:
        next.updatedAt.getTime() <= previous.updatedAt.getTime()
          ? new Date()
          : next.updatedAt,
    };

    this.validator.validate(versioned);

    if (this.transactionRunner.isActive()) {
      return this.store.save(previous, versioned);
    }

    return this.transactionRunner.execute(() =>
      this.store.save(previous, versioned),
    );
  }

  async findByParentWorkflowId(
    parentWorkflowId: string,
  ): Promise<WorkflowExecutionState[]> {
    return this.store.findByParentWorkflowId(parentWorkflowId);
  }

  async delete(workflowId: string): Promise<void> {
    try {
      await this.leaseService.release(workflowId);
    } catch {
      // Ignore lease release failures during cleanup.
    }

    if (this.transactionRunner.isActive()) {
      return this.deleteInternal(workflowId);
    }

    await this.transactionRunner.execute(() => this.deleteInternal(workflowId));
  }

  private async deleteInternal(workflowId: string): Promise<void> {
    await this.history.delete(workflowId);
    await this.signals.deleteByWorkflowId(workflowId);
    await this.idempotency.deleteByWorkflowId(workflowId);
    await this.store.delete(workflowId);
  }

  async findRunning(): Promise<WorkflowExecutionState[]> {
    return (await this.store.findRunning?.()) ?? [];
  }

  async findWaiting(): Promise<WorkflowExecutionState[]> {
    return (await this.store.findWaiting?.()) ?? [];
  }

  async findFailed(): Promise<WorkflowExecutionState[]> {
    return (await this.store.findFailed?.()) ?? [];
  }

  async findStuck(olderThanMs: number): Promise<WorkflowExecutionState[]> {
    return (await this.store.findStuck?.(olderThanMs)) ?? [];
  }

  async deleteCompleted(
    workflowName?: string,
    workflowVersion?: number,
    olderThanMs?: number,
  ): Promise<number> {
    return (
      (await this.store.deleteCompleted?.(
        workflowName,
        workflowVersion,
        olderThanMs,
      )) ?? 0
    );
  }
}
