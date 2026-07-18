export interface WorkflowApprovalDecision {
  readonly approved: boolean;

  readonly approverId: string;

  readonly reason?: string;
}
