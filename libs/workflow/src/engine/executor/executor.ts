import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { WorkflowCompletionService } from '../lifecycle/completion.service';
import { WorkflowFailureService } from '../lifecycle/failure.service';
import { WorkflowLifecyclePublisher } from '../lifecycle/lifecycle.publisher';
import { WorkflowLifecycleService } from '../lifecycle/lifecycle.service';
import { WorkflowRegistry } from '../registry/registry';
import { WorkflowSignalProcessor } from '../signals/signal.processor';
import { WorkflowStateService } from '../state/service';
import { ChildWorkflowService } from '../child-workflow/child-workflow.service';
import { WorkflowRunner } from './runner';
import {
  WORKFLOW_IDEMPOTENCY_STORE,
  WORKFLOW_TRANSACTION_RUNNER,
} from '../../constants/workflow.tokens';
import { WorkflowLeaseService } from '../../infrastructure/lease/lease.service';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowExecutionResult } from '../../models/workflow-execution-result';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowSignal } from '../../models/workflow-signal';
import { WorkflowLogger } from '../../observability/logger';
import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';
import { buildSignalIdempotencyKey } from '../../shared/utils/workflow-idempotency-key';
import type { WorkflowIdempotencyStore } from '../../ports/workflow-idempotency-store';

export interface WorkflowExecutionOptions {
  readonly correlationId?: string;
  readonly parentWorkflowId?: string;
  readonly parentExecutionId?: string;
  readonly workflowVersion?: number | undefined;
  readonly joinId?: string | undefined;

  /**
   * Overrides the generated `workflowId` with a caller-supplied, stable one.
   * Used by `ChildWorkflowService` to make child creation idempotent under
   * replay (see `WorkflowPendingEffect`'s `'start-children'`/`'spawn-fan-out'`
   * markers): a deterministic id means re-invoking `execute()` for the same
   * logical child hits the primary key and throws `WorkflowConcurrencyError`
   * instead of silently creating a duplicate.
   */
  readonly workflowId?: string;
}

@Injectable()
export class WorkflowExecutor {
  constructor(
    private readonly registry: WorkflowRegistry,

    private readonly signalProcessor: WorkflowSignalProcessor,
    private readonly completionService: WorkflowCompletionService,
    private readonly publisher: WorkflowLifecyclePublisher,
    private readonly logger: WorkflowLogger,
    private readonly lifecycle: WorkflowLifecycleService,
    private readonly runner: WorkflowRunner,

    @Inject(WORKFLOW_TRANSACTION_RUNNER)
    private readonly transactionRunner: WorkflowTransactionRunner,

    private readonly leaseService: WorkflowLeaseService,

    private readonly stateService: WorkflowStateService,
    @Inject(forwardRef(() => WorkflowFailureService))
    private readonly failureService: WorkflowFailureService,

    @Inject(WORKFLOW_IDEMPOTENCY_STORE)
    private readonly idempotency: WorkflowIdempotencyStore,

    @Inject(forwardRef(() => ChildWorkflowService))
    private readonly children: ChildWorkflowService,
  ) {}

  private toResult(state: WorkflowExecutionState): WorkflowExecutionResult {
    return {
      workflowId: state.workflowId,
      status: state.status,
      iteration: state.iteration,
      currentStep: state.currentStep,
      data: state.data,
    };
  }
  private async withLease<T>(
    workflowId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.leaseService.acquire(workflowId);

    try {
      return await operation();
    } finally {
      await this.leaseService.release(workflowId);
    }
  }

  private async finalize(
    state: WorkflowExecutionState,
  ): Promise<WorkflowExecutionResult> {
    const latest = (await this.stateService.load(state.workflowId)) ?? state;

    const { state: finalState } =
      await this.completionService.completeIfFinished(latest);

    return this.toResult(finalState);
  }

  /**
   * Deliberately does NOT wrap `runner.run()` in a single outer transaction.
   * `run()`'s loop can process many sequential steps in one pass (it only
   * breaks on a wait/sleep/join or workflow completion), and every
   * individual persistence call inside it (`WorkflowStepPersistenceService`,
   * `WorkflowLifecycleService`, `WorkflowFailureService`, etc.) already
   * scopes itself to its own atomic unit via `transactionRunner.executeOrJoin`.
   * Wrapping the whole loop in one outer transaction here would make those
   * inner calls silently *join* it instead of committing independently —
   * holding one DB transaction open across every step's handler execution in
   * the pass, and delaying every step's `afterCommit`-deferred side effect
   * (child spawning, retry scheduling, etc.) until the entire pass finishes
   * rather than shortly after the step that scheduled it actually committed.
   */
  async resume(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.withLease(workflowId, async () => {
      const { workflow, state } = await this.lifecycle.resume(workflowId);

      let finalState: WorkflowExecutionState;

      try {
        finalState = await this.runner.run(workflow, state);
      } catch (error) {
        const reloadedState =
          (await this.stateService.load(workflowId)) ?? state;
        await this.failureService.failExecution(reloadedState, error);
        throw error;
      }

      return this.finalize(finalState);
    });
  }

  /** See `resume()`'s doc comment — same reasoning applies here. */
  async wake(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.withLease(workflowId, async () => {
      const state = await this.stateService.wake(workflowId);
      const workflow = this.getDefinition(
        state.workflowName,
        state.workflowVersion,
      );

      let finalState: WorkflowExecutionState;

      try {
        finalState = await this.runner.run(workflow, state);
      } catch (error) {
        const reloadedState =
          (await this.stateService.load(workflowId)) ?? state;
        await this.failureService.handleFailure(reloadedState, error);
        throw error;
      }

      return this.finalize(finalState);
    });
  }

  /** See `resume()`'s doc comment — same reasoning applies here. */
  async resumeJoin(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.withLease(workflowId, async () => {
      const state = await this.stateService.resumeJoin(workflowId);
      const workflow = this.getDefinition(
        state.workflowName,
        state.workflowVersion,
      );

      let finalState: WorkflowExecutionState;

      try {
        finalState = await this.runner.run(workflow, state);
      } catch (error) {
        const reloadedState =
          (await this.stateService.load(workflowId)) ?? state;
        await this.failureService.handleFailure(reloadedState, error);
        throw error;
      }

      return this.finalize(finalState);
    });
  }

  /** See `resume()`'s doc comment — same reasoning applies here. */
  async execute(
    workflowName: string,
    initialData: Record<string, unknown> = {},
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowExecutionResult> {
    const { workflow, state: initialState } = await this.lifecycle.create(
      workflowName,
      initialData,
      options,
    );

    await this.leaseService.acquire(initialState.workflowId);

    try {
      let finalState: WorkflowExecutionState;

      try {
        finalState = await this.runner.run(workflow, initialState);
      } catch (error) {
        const reloadedState =
          (await this.stateService.load(initialState.workflowId)) ??
          initialState;
        await this.failureService.handleFailure(reloadedState, error);
        throw error;
      }

      return await this.finalize(finalState);
    } finally {
      await this.leaseService.release(initialState.workflowId);
    }
  }

  async cancel(
    workflowId: string,
    expired = false,
  ): Promise<WorkflowExecutionResult> {
    return this.transactionRunner.executeOrJoin(async () => {
      const cancelled = await this.stateService.cancel(workflowId, expired);
      const workflow = this.getDefinition(
        cancelled.workflowName,
        cancelled.workflowVersion,
      );

      const state = await this.stateService.setPendingEffect(cancelled, {
        type: 'cancel-children',
      });

      this.transactionRunner.afterCommit?.(async () => {
        await this.children.cancelChildren(workflow, state);
        await this.stateService.clearPendingEffect(state.workflowId);
      });

      return this.toResult(state);
    });
  }

  /**
   * See `resume()`'s doc comment for why `runner.run()` isn't wrapped in an
   * outer transaction. Since `signalProcessor.prepare()` already commits
   * itself (it wraps its own `executeOrJoin`) before `run()` starts, and
   * every step `run()` processes commits independently too, nothing is left
   * uncommitted by the time `run()` returns — so `signalProcessor.complete()`/
   * `publisher.signalled()` no longer need an `afterCommit` deferral to wait
   * for; they're called directly, immediately after.
   */
  async signal(
    workflowId: string,
    signal: WorkflowSignal,
  ): Promise<WorkflowExecutionResult> {
    let nextSignal: WorkflowSignal | undefined = signal;
    let result: WorkflowExecutionResult | undefined;

    while (nextSignal) {
      const currentSignal = nextSignal;

      result = await this.withLease(workflowId, async () => {
        const { state, acquired } = await this.signalProcessor.prepare(
          workflowId,
          currentSignal,
        );

        const workflow = this.getDefinition(
          state.workflowName,
          state.workflowVersion,
        );

        this.logger.signalReceived(
          workflow.metadata.name,
          workflowId,
          currentSignal.name,
          currentSignal.signalId,
        );

        let finalState: WorkflowExecutionState;

        try {
          finalState = await this.runner.run(workflow, state, currentSignal);
        } catch (error) {
          const latest = (await this.stateService.load(workflowId)) ?? state;
          await this.failureService.handleFailure(latest, error);

          if (acquired) {
            await this.idempotency.release(
              buildSignalIdempotencyKey(workflowId, currentSignal.signalId),
            );
          }

          throw error;
        }

        await this.signalProcessor.complete(workflowId, currentSignal.signalId);

        await this.publisher.signalled(workflow, finalState);

        const stepResult = await this.finalize(finalState);

        if (stepResult.status !== 'waiting') {
          nextSignal = undefined;
          return stepResult;
        }

        const pending = await this.signalProcessor.pending(workflowId);
        nextSignal = pending[0]?.signal;

        return stepResult;
      });
    }

    return result!;
  }

  async findByParentWorkflowId(parentWorkflowId: string) {
    return this.stateService.findByParentWorkflowId(parentWorkflowId);
  }

  getDefinition(workflowName: string, version?: number): RegisteredWorkflow {
    return version === undefined
      ? this.registry.getLatest(workflowName)
      : this.registry.get(workflowName, version);
  }
}
