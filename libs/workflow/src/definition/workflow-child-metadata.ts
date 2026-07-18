import { Type } from '@nestjs/common';

type WorkflowClass = Type<unknown>;

export type WorkflowChildFailurePolicy =
  'fail-parent' | 'ignore' | 'retry-child' | 'compensate-parent';

export type WorkflowChildCancellationPolicy = 'propagate' | 'detach';

export interface WorkflowChildMetadata {
  readonly workflow: WorkflowClass;

  readonly failurePolicy: WorkflowChildFailurePolicy;

  readonly cancellationPolicy: WorkflowChildCancellationPolicy;

  readonly maxRetries?: number;

  /**
   * `'onStart'` (default): started automatically once, when the parent
   * itself starts (existing behavior). `'step'`: never auto-started —
   * only spawned when a step's `WorkflowStepResult.spawnChildren`
   * references this workflow class (fan-out).
   */
  readonly trigger?: 'onStart' | 'step';
}
