import { Inject, Injectable, Logger } from '@nestjs/common';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowStateService } from '../state/service';
import { WorkflowStateTransitions } from '../state/transitions';
import { WorkflowSignalService } from './signal.service';
import {
  WORKFLOW_IDEMPOTENCY_STORE,
  WORKFLOW_TRANSACTION_RUNNER,
} from '../../constants/workflow.tokens';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowSignal } from '../../models/workflow-signal';
import type { WorkflowIdempotencyStore } from '../../ports/workflow-idempotency-store';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { buildSignalIdempotencyKey } from '../../shared/utils/workflow-idempotency-key';

@Injectable()
export class WorkflowSignalProcessor {
  private readonly logger = new Logger(WorkflowSignalProcessor.name);

  constructor(
    @Inject(WORKFLOW_IDEMPOTENCY_STORE)
    private readonly idempotency: WorkflowIdempotencyStore,

    private readonly signals: WorkflowSignalService,
    private readonly states: WorkflowStateService,
    private readonly transitions: WorkflowStateTransitions,
    private readonly registry: WorkflowRegistry,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,
  ) {}

  async prepare(
    workflowId: string,
    signal: WorkflowSignal,
  ): Promise<{ state: WorkflowExecutionState; acquired: boolean }> {
    return this.transactionRunner.executeOrJoin(() =>
      this.prepareInternal(workflowId, signal),
    );
  }

  private async prepareInternal(
    workflowId: string,
    signal: WorkflowSignal,
  ): Promise<{ state: WorkflowExecutionState; acquired: boolean }> {
    const state = await this.states.load(workflowId);

    if (!state) {
      throw new WorkflowExecutionError(`Workflow '${workflowId}' not found`);
    }

    const workflow = this.registry.get(
      state.workflowName,
      state.workflowVersion,
    );

    switch (state.status) {
      case 'completed':
        throw new WorkflowExecutionError(
          `Workflow '${workflowId}' has already completed.`,
        );

      case 'failed':
        throw new WorkflowExecutionError(
          `Workflow '${workflowId}' has failed.`,
        );

      case 'cancelled':
        throw new WorkflowExecutionError(
          `Workflow '${workflowId}' has been cancelled.`,
        );

      case 'running':
      case 'waiting':
        break;

      default:
        this.logger.warn(
          `Workflow '${workflowId}' has unrecognized status '${String(state.status)}'; proceeding as if it can accept signals.`,
        );
        state.status satisfies never;
    }

    const supported = workflow.metadata.signals?.supportedSignals;

    if (supported && supported.length > 0 && !supported.includes(signal.name)) {
      throw new WorkflowExecutionError(
        `Signal '${signal.name}' is not supported by workflow '${workflow.metadata.name}'`,
      );
    }

    if (
      state.status === 'running' &&
      workflow.metadata.signals?.bufferWhileRunning === false
    ) {
      throw new WorkflowExecutionError(
        `Workflow '${workflow.metadata.name}' is not currently waiting for signals.`,
      );
    }

    const key = buildSignalIdempotencyKey(workflowId, signal.signalId);

    const acquired = await this.idempotency.acquire(key, workflowId);

    if (!acquired) {
      return { state, acquired: false };
    }

    const appended = await this.signals.append(workflowId, signal);

    if (!appended) {
      // The idempotency store just granted this signalId for this workflow,
      // so a duplicate-key hit here means the signal row already exists
      // outside the idempotency store's bookkeeping (e.g. a prior attempt
      // crashed after the insert but before markCompleted). Treat it as
      // already-recorded rather than re-processing.
      this.logger.warn(
        `Signal '${signal.signalId}' for workflow '${workflowId}' was already recorded; skipping re-append.`,
      );

      return { state, acquired: false };
    }

    if (state.status !== 'waiting') {
      return { state, acquired: true };
    }

    if (state.waitingForSignal?.name !== signal.name) {
      throw new WorkflowExecutionError(
        `Workflow '${workflowId}' is not waiting for '${signal.name}'`,
      );
    }

    const resumed = this.transitions.resumeFromSignal(state);

    return { state: await this.states.save(state, resumed), acquired: true };
  }

  async complete(workflowId: string, signalId: string): Promise<void> {
    const existing = await this.signals.load(workflowId, signalId);

    if (existing?.processed) {
      return;
    }

    await this.signals.markProcessed(workflowId, signalId);

    await this.idempotency.markCompleted(
      buildSignalIdempotencyKey(workflowId, signalId),
      workflowId,
    );
  }

  async pending(workflowId: string) {
    return this.signals.pending(workflowId);
  }
}
