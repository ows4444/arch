import { WorkflowStepId } from '../models/workflow-step-id';
import { WorkflowStepCompensationMetadata } from './workflow-step-compensation-metadata';
import { WorkflowStepInputSpecification } from './workflow-step-input-specification';

export interface WorkflowStepMetadata {
  readonly workflow: string;

  readonly workflowVersion?: number;

  readonly step: WorkflowStepId;

  readonly deprecated?: boolean;

  readonly replacedBy?: WorkflowStepId;

  readonly compensation?: WorkflowStepCompensationMetadata;

  readonly timeoutMs?: number;

  /**
   * When set, the step's input `data` must satisfy this specification before the handler runs —
   * see `WorkflowStepInputValidator` and ARCH.md Design 002.
   */
  readonly inputSpec?: WorkflowStepInputSpecification<unknown>;
}
