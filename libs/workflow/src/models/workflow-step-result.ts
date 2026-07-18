import { WorkflowChildSpawnSpec } from './workflow-child-spawn-spec';
import { WorkflowJoinPolicy } from './workflow-join-policy';
import { WorkflowSignal } from './workflow-signal';
import { WorkflowStepId } from './workflow-step-id';

export interface WorkflowStepResult<TState extends object = object> {
  readonly nextStep?: WorkflowStepId;

  readonly waitForSignal?: WorkflowSignal;

  /**
   * Fan out to one child workflow execution per entry, then pause until
   * `joinPolicy` is satisfied before resuming at `nextStep`. Each branch is
   * a full child workflow execution (its own state row, lease, failure/
   * compensation policy via the parent's declared `childWorkflows` — the
   * referenced `workflow` type must also appear there with `trigger:
   * 'step'`). Mutually exclusive with `waitForSignal`/`sleepUntil`/`sleepMs`.
   */
  readonly spawnChildren?: readonly WorkflowChildSpawnSpec[];

  /** Quorum required to resume once fanned-out children complete. Defaults to 'all'. */
  readonly joinPolicy?: WorkflowJoinPolicy;

  /**
   * Durably sleep until this absolute time before resuming at `nextStep`.
   * Mutually exclusive with `waitForSignal`. Survives process restarts via
   * the same auto-recovery sweep that wakes crash-recovered workflows.
   */
  readonly sleepUntil?: Date;

  /** Convenience form of `sleepUntil`, resolved to `Date.now() + sleepMs`. */
  readonly sleepMs?: number;

  readonly data?: Partial<TState>;
}
