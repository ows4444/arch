import { ApprovalDecisionStepHandler } from './approval-decision-step.handler';
import { WorkflowExecutionError } from '../errors/workflow.errors';
import { WorkflowApprovalDecision } from '../models/workflow-approval-decision';
import { createWorkflowStepId } from '../models/workflow-step-id';
import { WorkflowStepResult } from '../models/workflow-step-result';
import { WorkflowContext } from '../types/workflow-context';

class HandleExpenseDecisionStep extends ApprovalDecisionStepHandler {
  protected onApproved(
    _context: WorkflowContext,
    decision: WorkflowApprovalDecision,
  ): WorkflowStepResult {
    return {
      nextStep: createWorkflowStepId('pay-expense'),
      data: { approvedBy: decision.approverId },
    };
  }

  protected onRejected(
    _context: WorkflowContext,
    decision: WorkflowApprovalDecision,
  ): WorkflowStepResult {
    return {
      nextStep: createWorkflowStepId('notify-rejected'),
      data: { rejectedBy: decision.approverId },
    };
  }
}

function context(payload?: unknown): WorkflowContext {
  return {
    workflowId: 'wf-1',
    correlationId: 'corr-1',
    stepExecutionKey: 'wf-1:handle-decision:2',
    executionId: 'exec-1',
    workflowName: 'expense-workflow',
    currentStep: 'handle-decision',
    data: {},
    signal:
      payload === undefined
        ? undefined
        : { name: 'expense-approval', signalId: 'sig-1', payload },
    runtime: {
      abortSignal: new AbortController().signal,
      isCancelled: () => Promise.resolve(false),
    },
  };
}

describe('ApprovalDecisionStepHandler', () => {
  it('dispatches to onApproved when the decision payload approves', async () => {
    const step = new HandleExpenseDecisionStep();

    const result = await step.execute(
      context({ approved: true, approverId: 'user-1' }),
    );

    expect(result).toEqual({
      nextStep: 'pay-expense',
      data: { approvedBy: 'user-1' },
    });
  });

  it('dispatches to onRejected when the decision payload rejects', async () => {
    const step = new HandleExpenseDecisionStep();

    const result = await step.execute(
      context({ approved: false, approverId: 'user-2', reason: 'over budget' }),
    );

    expect(result).toEqual({
      nextStep: 'notify-rejected',
      data: { rejectedBy: 'user-2' },
    });
  });

  it('throws when no signal is present', async () => {
    const step = new HandleExpenseDecisionStep();

    await expect(step.execute(context(undefined))).rejects.toThrow(
      WorkflowExecutionError,
    );
  });

  it('throws when the signal payload is missing approverId', async () => {
    const step = new HandleExpenseDecisionStep();

    await expect(step.execute(context({ approved: true }))).rejects.toThrow(
      /expected an approval decision signal/,
    );
  });

  it('throws when the signal payload has a non-boolean approved field', async () => {
    const step = new HandleExpenseDecisionStep();

    await expect(
      step.execute(context({ approved: 'yes', approverId: 'user-1' })),
    ).rejects.toThrow(WorkflowExecutionError);
  });
});
