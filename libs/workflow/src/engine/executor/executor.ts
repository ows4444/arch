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

  async resume(workflowId: string): Promise<WorkflowExecutionResult> {
    return this.withLease(workflowId, async () => {
      let pendingError: unknown;
      let failed = false;

      const outcome = await this.transactionRunner.execute(async () => {
        const { workflow, state } = await this.lifecycle.resume(workflowId);

        let finalState: WorkflowExecutionState;

        try {
          finalState = await this.runner.run(workflow, state);
        } catch (error) {
          const reloadedState =
            (await this.stateService.load(workflowId)) ?? state;
          await this.failureService.failExecution(reloadedState, error);
          failed = true;
          pendingError = error;
          return undefined;
        }

        return await this.finalize(finalState);
      });

      if (failed) {
        throw pendingError;
      }

      return outcome as WorkflowExecutionResult;
    });
  }

  async execute(
    workflowName: string,
    initialData: Record<string, unknown> = {},
    options?: WorkflowExecutionOptions,
  ): Promise<WorkflowExecutionResult> {
    let pendingError: unknown;
    let failed = false;

    const outcome = await this.transactionRunner.executeOrJoin(async () => {
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
          failed = true;
          pendingError = error;
          return undefined;
        }

        return await this.finalize(finalState);
      } finally {
        await this.leaseService.release(initialState.workflowId);
      }
    });

    if (failed) {
      throw pendingError;
    }

    return outcome as WorkflowExecutionResult;
  }

  async cancel(
    workflowId: string,
    expired = false,
  ): Promise<WorkflowExecutionResult> {
    return this.transactionRunner.executeOrJoin(async () => {
      const state = await this.stateService.cancel(workflowId, expired);
      const workflow = this.getDefinition(
        state.workflowName,
        state.workflowVersion,
      );

      this.transactionRunner.afterCommit?.(() =>
        this.children.cancelChildren(workflow, state),
      );

      return this.toResult(state);
    });
  }

  async signal(
    workflowId: string,
    signal: WorkflowSignal,
  ): Promise<WorkflowExecutionResult> {
    let nextSignal: WorkflowSignal | undefined = signal;
    let result: WorkflowExecutionResult | undefined;

    while (nextSignal) {
      const currentSignal = nextSignal;

      result = await this.withLease(workflowId, async () => {
        let pendingError: unknown;
        let failed = false;

        const outcome = await this.transactionRunner.executeOrJoin(async () => {
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

            failed = true;
            pendingError = error;
            return undefined;
          }

          this.transactionRunner.afterCommit?.(async () => {
            await this.signalProcessor.complete(
              workflowId,
              currentSignal.signalId,
            );

            await this.publisher.signalled(workflow, finalState);
          });

          const stepResult = await this.finalize(finalState);

          if (stepResult.status !== 'waiting') {
            nextSignal = undefined;
            return stepResult;
          }

          const pending = await this.signalProcessor.pending(workflowId);
          nextSignal = pending[0]?.signal;

          return stepResult;
        });

        if (failed) {
          throw pendingError;
        }

        return outcome as WorkflowExecutionResult;
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
