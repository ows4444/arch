import { WorkflowStepId } from '../models/workflow-step-id';
import { WorkflowStepCompensationMetadata } from './workflow-step-compensation-metadata';

export interface WorkflowStepMetadata {
  readonly workflow: string;

  readonly workflowVersion?: number;

  readonly step: WorkflowStepId;

  readonly deprecated?: boolean;

  readonly replacedBy?: WorkflowStepId;

  readonly compensation?: WorkflowStepCompensationMetadata;

  readonly timeoutMs?: number;
}
