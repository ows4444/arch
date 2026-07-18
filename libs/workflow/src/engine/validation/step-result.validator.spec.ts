import { WorkflowStepResultValidator } from './step-result.validator';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { createWorkflowStepId } from '../../models/workflow-step-id';

function workflow(stepIds: string[]): RegisteredWorkflow {
  return {
    steps: new Map(
      stepIds.map((id) => [
        createWorkflowStepId(id),
        { metadata: { workflow: 'wf', step: createWorkflowStepId(id) } },
      ]),
    ),
  } as unknown as RegisteredWorkflow;
}

describe('WorkflowStepResultValidator.validate', () => {
  const validator = new WorkflowStepResultValidator();
  const currentStep = createWorkflowStepId('step-1');

  it('does not throw when the result specifies neither nextStep nor waitForSignal', () => {
    expect(() =>
      validator.validate(workflow(['step-1']), currentStep, {}),
    ).not.toThrow();
  });

  it('does not throw when nextStep references a known step', () => {
    const wf = workflow(['step-1', 'step-2']);

    expect(() =>
      validator.validate(wf, currentStep, {
        nextStep: createWorkflowStepId('step-2'),
      }),
    ).not.toThrow();
  });

  it('throws when nextStep references an unknown step', () => {
    const wf = workflow(['step-1']);

    expect(() =>
      validator.validate(wf, currentStep, {
        nextStep: createWorkflowStepId('missing'),
      }),
    ).toThrow(WorkflowExecutionError);
  });

  it('throws when waitForSignal is set without a resume step', () => {
    const wf = workflow(['step-1']);

    expect(() =>
      validator.validate(wf, currentStep, {
        waitForSignal: { name: 'approval', signalId: 'sig-1' },
      }),
    ).toThrow(/does not specify a resume step/);
  });

  it('does not throw when waitForSignal is paired with a known resume step', () => {
    const wf = workflow(['step-1', 'step-2']);

    expect(() =>
      validator.validate(wf, currentStep, {
        waitForSignal: { name: 'approval', signalId: 'sig-1' },
        nextStep: createWorkflowStepId('step-2'),
      }),
    ).not.toThrow();
  });
});
