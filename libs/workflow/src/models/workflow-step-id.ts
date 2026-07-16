export type WorkflowStepId = string & {
  readonly __brand: 'WorkflowStepId';
};

export function createWorkflowStepId(id: string): WorkflowStepId {
  return id as WorkflowStepId;
}
