import { WorkflowStepId } from '../models/workflow-step-id';

export interface WorkflowDefinitionMetadata {
  readonly start: WorkflowStepId;

  readonly transitions: Partial<
    Record<WorkflowStepId, readonly WorkflowStepId[]>
  >;

  readonly allowCycles?: boolean;
}
