import { forwardRef, Inject, Injectable, Logger, Type } from '@nestjs/common';

import { WorkflowExecutor } from '../executor/executor';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { WorkflowChildSpawnSpec } from '../../models/workflow-child-spawn-spec';
import { WorkflowExecutionResult } from '../../models/workflow-execution-result';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { WorkflowJoinPolicy } from '../../models/workflow-join-policy';
import { WorkflowJoinSummary } from '../../models/workflow-join-summary';
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
import {
  WorkflowError,
  WorkflowExecutionError,
} from '../../errors/workflow.errors';
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

  private resolveByType(type: Type<unknown>): RegisteredWorkflow | undefined {
    return this.registry
      .getAll()
      .find((candidate) => candidate.workflowType === type);
  }

  private resolveRegisteredChild(
    definition: WorkflowChildMetadata,
  ): RegisteredWorkflow | undefined {
    return this.resolveByType(definition.workflow);
  }

  /**
   * `'all'` means every branch has reached a *terminal outcome* — success,
   * cancellation, or a failure the engine will never retry — not that every
   * branch succeeded. A permanently-failed branch (`failurePolicy: 'ignore'`,
   * or `'retry-child'` with retries exhausted) still resolves the join;
   * hanging forever for something that will never happen would be worse
   * than resuming with a partial result. It's the join step's job to
   * notice a partial failure if it cares (e.g. via
   * `ChildWorkflowService.findChildren()`), not the engine's job to
   * silently wait.
   *
   * `'any'`/`{ min }` still count only successes toward the quorum itself
   * ("resume once N branches succeed" is their whole point), but also
   * resume — flagged as `unreachable` — once no combination of the
   * still-in-flight siblings could possibly reach `min` anymore (e.g.
   * `{ min: 2 }` with 3 siblings where 2 have already permanently failed).
   * Same reasoning as `'all'`: waiting for something that provably can't
   * happen is worse than surfacing it to the join step.
   */
  private evaluateJoin(
    workflow: RegisteredWorkflow,
    policy: WorkflowJoinPolicy,
    siblings: readonly WorkflowExecutionState[],
  ): { shouldResume: boolean; unreachable: boolean } {
    let succeededCount = 0;
    let resolvedCount = 0;

    for (const sibling of siblings) {
      const category = this.categorizeChild(workflow, sibling);

      if (category !== 'pending') {
        resolvedCount++;
      }

      if (category === 'succeeded') {
        succeededCount++;
      }
    }

    if (policy === 'all') {
      return {
        shouldResume: siblings.length > 0 && resolvedCount === siblings.length,
        unreachable: false,
      };
    }

    const min = policy === 'any' ? 1 : policy.min;

    if (succeededCount >= min) {
      return { shouldResume: true, unreachable: false };
    }

    // Everything not yet resolved could still, in the best case, succeed —
    // if even that best case can't reach `min`, it never will. Guarded by
    // `siblings.length > 0` for the same reason 'all' is: zero siblings
    // usually means the fan-out's children haven't been spawned yet (or
    // never will be, e.g. a process crash between the parent's own commit
    // and `spawnFanOut`'s afterCommit callback actually running) rather
    // than a genuine "nothing left could succeed" — without this guard,
    // WorkflowAutoRecoveryService's stuck-join sweep would treat a parent
    // it catches in that exact window as unreachable and resume it with an
    // empty join summary before any child ever ran.
    const stillInFlight = siblings.length - resolvedCount;
    const unreachable =
      siblings.length > 0 && succeededCount + stillInFlight < min;

    return { shouldResume: unreachable, unreachable };
  }

  /**
   * `'succeeded'`: completed. `'failed'`: resolved but not completed
   * (cancelled, or permanently failed per `isChildResolved`). `'pending'`:
   * still in flight — could yet become either. Shared by `evaluateJoin`
   * (which only needs the counts) and `summarizeJoin` (which hands the
   * join step the actual sibling states per category).
   */
  private categorizeChild(
    workflow: RegisteredWorkflow,
    child: WorkflowExecutionState,
  ): 'succeeded' | 'failed' | 'pending' {
    if (child.status === 'completed') {
      return 'succeeded';
    }

    const definition = this.findDefinition(workflow, child);
    const resolved = definition
      ? this.isChildResolved(child, definition)
      : false;

    return resolved ? 'failed' : 'pending';
  }

  private isChildResolved(
    child: WorkflowExecutionState,
    definition: WorkflowChildMetadata,
  ): boolean {
    if (child.status === 'completed' || child.status === 'cancelled') {
      return true;
    }

    if (child.status !== 'failed') {
      return false;
    }

    if (definition.failurePolicy === 'retry-child') {
      const maxRetries = definition.maxRetries ?? 1;

      return (child.failureCount ?? 0) >= maxRetries;
    }

    // 'ignore' is terminal immediately on failure. 'fail-parent'/
    // 'compensate-parent' already pull the parent out of
    // 'waiting-children' before checkJoinQuorum would ever see this sibling
    // again, so treating them as resolved here is defensive, not load-bearing.
    return true;
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

  /**
   * Categorizes the fan-out siblings for one join episode into
   * succeeded/failed/pending, so a join step can see what happened to its
   * branches without reimplementing `checkJoinQuorum`'s filtering itself.
   * Exposed to step handlers via `WorkflowContext.runtime.joinResults()`
   * (built in `WorkflowStepExecutor` from `state.joinId`, which
   * `resumeFromJoin` now deliberately preserves through the join step's
   * own execution instead of clearing it immediately).
   */
  async summarizeJoin(
    parentWorkflowId: string,
    joinId: string,
  ): Promise<WorkflowJoinSummary> {
    const parent = await this.stateService.load(parentWorkflowId);

    if (!parent) {
      throw new WorkflowExecutionError(
        `Workflow '${parentWorkflowId}' not found`,
      );
    }

    const workflow = this.registry.get(
      parent.workflowName,
      parent.workflowVersion,
    );

    const siblings = (
      await this.stateService.findByParentWorkflowId(parentWorkflowId)
    ).filter((sibling) => sibling.joinId === joinId);

    const succeeded: WorkflowExecutionState[] = [];
    const failed: WorkflowExecutionState[] = [];
    const pending: WorkflowExecutionState[] = [];

    for (const sibling of siblings) {
      const category = this.categorizeChild(workflow, sibling);

      if (category === 'succeeded') {
        succeeded.push(sibling);
      } else if (category === 'failed') {
        failed.push(sibling);
      } else {
        pending.push(sibling);
      }
    }

    return { succeeded, failed, pending };
  }

  async onChildCompleted(
    parent: WorkflowExecutionState,
    child: WorkflowExecutionState,
  ): Promise<void> {
    const managed = this.getManagedChild(parent, child);

    if (!managed) {
      return;
    }

    this.logger.debug(
      `Child workflow '${child.workflowName}' (${child.workflowId}) completed ` +
        `for parent '${parent.workflowName}' (${parent.workflowId})`,
    );

    if (child.joinId) {
      await this.checkJoinQuorum(parent.workflowId);
    }
  }

  /**
   * Re-evaluates whether a parent currently paused in a fan-out
   * (`'waiting-children'`) has had its `joinPolicy` satisfied, and resumes
   * it at the declared join step if so. Reloads the parent fresh rather
   * than trusting a caller-passed state, since this can run after a nested
   * `resume()` (via `retryChild`) that may have already changed it —
   * acting on a stale `parent.status` here could either miss a quorum that
   * was just met or, worse, double-call `resumeJoin` on a parent that
   * already moved on.
   *
   * Public (not just called from `onChildCompleted`/`onChildFailed`) so
   * `WorkflowAutoRecoveryService` can re-check it as a safety net for
   * `'waiting-children'` parents whose event-driven resume was missed
   * (e.g. a `resumeJoin()` lease race the first time quorum was met).
   *
   * Returns whether it actually resumed the parent, so callers can report
   * a precise count rather than just "checked."
   */
  async checkJoinQuorum(parentWorkflowId: string): Promise<boolean> {
    const parent = await this.stateService.load(parentWorkflowId);

    if (!parent || parent.status !== 'waiting-children' || !parent.joinId) {
      return false;
    }

    const parentWorkflow = this.registry.get(
      parent.workflowName,
      parent.workflowVersion,
    );

    const siblings = (
      await this.stateService.findByParentWorkflowId(parent.workflowId)
    ).filter((sibling) => sibling.joinId === parent.joinId);

    const evaluation = this.evaluateJoin(
      parentWorkflow,
      parent.joinPolicy ?? 'all',
      siblings,
    );

    if (!evaluation.shouldResume) {
      return false;
    }

    if (evaluation.unreachable) {
      this.logger.warn(
        `Join quorum for parent '${parent.workflowId}' can never be reached ` +
          `(too many fanned-out branches permanently failed) — resuming ` +
          `anyway with a partial result rather than waiting forever.`,
      );
    }

    try {
      await this.executor.resumeJoin(parent.workflowId);

      return true;
    } catch (error) {
      this.logger.error(
        `Failed to resume parent '${parent.workflowId}' after its fan-out join quorum was met`,
        error instanceof Error ? error.stack : String(error),
      );

      return false;
    }
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
        // 'ignore' is terminal immediately — if this child belongs to an
        // active fan-out, its permanent failure may now satisfy an 'all'
        // join that would otherwise wait forever (see evaluateJoin).
        if (child.joinId) {
          await this.checkJoinQuorum(parent.workflowId);
        }

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

        // retryChild() either resumed the child (still in-flight, not
        // resolved) or gave up once maxRetries was reached (now
        // permanently 'failed') — checkJoinQuorum re-reads the child's
        // current status itself, so it's correct either way.
        if (child.joinId) {
          await this.checkJoinQuorum(parent.workflowId);
        }

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

        const fullyCompensated = await this.compensation.compensate(
          parentWorkflow,
          parent,
        );

        if (!fullyCompensated) {
          this.logger.error(
            `Compensation did not fully complete for parent '${parent.workflowId}' ` +
              `after child '${child.workflowId}' failure — one or more steps' ` +
              `compensation handlers failed and will require manual intervention.`,
          );
        }

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
    const children = workflow.metadata.childWorkflows?.filter(
      (child) => (child.trigger ?? 'onStart') === 'onStart',
    );

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

  /**
   * Starts one child workflow execution per fan-out spec, tagging each
   * with `state.joinId` so `checkJoinQuorum` can later scope sibling
   * counting to this specific fan-out episode. Mirrors `startChildren`'s
   * partial-failure handling (cancel already-started siblings, fail the
   * parent) as its own self-contained block rather than a shared helper —
   * the two differ enough (static list with empty input vs. dynamic specs
   * with per-branch input and a `trigger: 'step'` declaration check) that
   * forcing a shared abstraction seemed more likely to obscure than help.
   */
  async spawnFanOut(
    workflow: RegisteredWorkflow,
    state: WorkflowExecutionState,
    specs: readonly WorkflowChildSpawnSpec[],
  ): Promise<void> {
    if (specs.length === 0) {
      return;
    }

    const results = await Promise.allSettled(
      specs.map(async (spec) => {
        const definition = workflow.metadata.childWorkflows?.find(
          (candidate) => candidate.workflow === spec.workflow,
        );

        if (!definition || definition.trigger !== 'step') {
          throw new NonRetriableWorkflowError(
            `Fan-out spawned a workflow class not declared with trigger: 'step' ` +
              `in '${workflow.metadata.name}''s childWorkflows`,
          );
        }

        const registered = this.resolveByType(spec.workflow);

        if (!registered) {
          throw new NonRetriableWorkflowError(
            `Fan-out child workflow class for '${workflow.metadata.name}' is not registered`,
          );
        }

        return this.executor.execute(
          registered.metadata.name,
          spec.input ?? {},
          {
            correlationId: state.correlationId,
            parentWorkflowId: state.workflowId,
            parentExecutionId: state.executionId,
            joinId: state.joinId,
          },
        );
      }),
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
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
      `Failed to spawn ${failures.length}/${specs.length} fan-out child workflow(s) ` +
        `for parent '${state.workflowId}': ` +
        failures
          .map((failure) =>
            failure.reason instanceof Error
              ? failure.reason.message
              : String(failure.reason),
          )
          .join('; ') +
        (started.length > 0
          ? `. Cancelled ${started.length} already-started sibling child workflow(s).`
          : ''),
    );

    await this.parentFailureHandler.failExecution(
      state,
      new NonRetriableWorkflowError(
        `Failed to spawn ${failures.length} of ${specs.length} fan-out child workflow(s).`,
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
