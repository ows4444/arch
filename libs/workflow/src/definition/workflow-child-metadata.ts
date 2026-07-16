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
}
