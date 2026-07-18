import { RequestApprovalStepHandler } from './request-approval-step.handler';
import { createWorkflowStepId } from '../models/workflow-step-id';
import { WorkflowContext } from '../types/workflow-context';

class ApproveExpenseStep extends RequestApprovalStepHandler {
  protected readonly signalName = 'expense-approval';
  protected readonly resumeStep = createWorkflowStepId('handle-decision');
}

function context(): WorkflowContext {
  return {
    workflowId: 'wf-1',
    correlationId: 'corr-1',
    stepExecutionKey: 'wf-1:request-approval:1',
    executionId: 'exec-1',
    workflowName: 'expense-workflow',
    currentStep: 'request-approval',
    data: {},
    runtime: {
      abortSignal: new AbortController().signal,
      isCancelled: () => Promise.resolve(false),
    },
  };
}

describe('RequestApprovalStepHandler', () => {
  it('waits on the configured signal and resumes at the configured step', async () => {
    const step = new ApproveExpenseStep();

    const result = await step.execute(context());

    expect(result.waitForSignal).toEqual({
      name: 'expense-approval',
      signalId: 'wf-1:request-approval:1',
    });
    expect(result.nextStep).toBe('handle-decision');
  });

  it('scopes signalId to the step execution key so repeated waits do not collide', async () => {
    const step = new ApproveExpenseStep();

    const first = await step.execute(context());
    const second = await step.execute({
      ...context(),
      stepExecutionKey: 'wf-1:request-approval:2',
    });

    expect(first.waitForSignal?.signalId).not.toBe(
      second.waitForSignal?.signalId,
    );
  });
});
