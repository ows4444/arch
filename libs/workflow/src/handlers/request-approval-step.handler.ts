import { WorkflowStepId } from '../models/workflow-step-id';
import { WorkflowStepResult } from '../models/workflow-step-result';
import { WorkflowContext } from '../types/workflow-context';
import { WorkflowStepHandler } from './workflow-step-handler';

/**
 * Sugar over the engine's existing `waitForSignal`/`findWaitingExpired`
 * primitives for the common "pause for a human decision" shape. Pairs with
 * an `ApprovalDecisionStepHandler` registered at `resumeStep` — the engine
 * resumes execution *at that step* when the signal arrives, so this
 * handler's `execute()` only ever runs once, to start the wait.
 */
export abstract class RequestApprovalStepHandler<
  TState extends object = object,
> implements WorkflowStepHandler<TState> {
  protected abstract readonly signalName: string;

  protected abstract readonly resumeStep: WorkflowStepId;

  execute(
    context: WorkflowContext<TState>,
  ): Promise<WorkflowStepResult<TState>> {
    return Promise.resolve({
      waitForSignal: {
        name: this.signalName,
        signalId: context.stepExecutionKey,
      },
      nextStep: this.resumeStep,
    });
  }
}
