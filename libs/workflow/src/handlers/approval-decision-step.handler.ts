import { WorkflowExecutionError } from '../errors/workflow.errors';
import { WorkflowApprovalDecision } from '../models/workflow-approval-decision';
import { WorkflowStepResult } from '../models/workflow-step-result';
import { WorkflowContext } from '../types/workflow-context';
import { WorkflowStepHandler } from './workflow-step-handler';

/**
 * Pairs with `RequestApprovalStepHandler` as its `resumeStep` target: runs
 * when the paired approval signal arrives, and dispatches to
 * `onApproved`/`onRejected` based on the signal payload. The payload shape
 * (`approved`/`approverId`/`reason?`) is a library convention this class
 * enforces — the engine itself has no opinion on signal payload shape.
 */
export abstract class ApprovalDecisionStepHandler<
  TState extends object = object,
> implements WorkflowStepHandler<TState> {
  async execute(
    context: WorkflowContext<TState>,
  ): Promise<WorkflowStepResult<TState>> {
    const decision = context.signal?.payload as
      WorkflowApprovalDecision | undefined;

    if (
      !decision ||
      typeof decision.approved !== 'boolean' ||
      !decision.approverId
    ) {
      throw new WorkflowExecutionError(
        `Step '${context.currentStep}' expected an approval decision signal ` +
          `payload shaped { approved: boolean; approverId: string; reason?: string }, ` +
          `got: ${JSON.stringify(context.signal?.payload)}`,
      );
    }

    return decision.approved
      ? this.onApproved(context, decision)
      : this.onRejected(context, decision);
  }

  protected abstract onApproved(
    context: WorkflowContext<TState>,
    decision: WorkflowApprovalDecision,
  ): WorkflowStepResult<TState> | Promise<WorkflowStepResult<TState>>;

  protected abstract onRejected(
    context: WorkflowContext<TState>,
    decision: WorkflowApprovalDecision,
  ): WorkflowStepResult<TState> | Promise<WorkflowStepResult<TState>>;
}
