import { WorkflowTransitionValidator } from './transition-validator';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { createWorkflowStepId } from '../../models/workflow-step-id';

describe('WorkflowTransitionValidator', () => {
  const validator = new WorkflowTransitionValidator();

  const step1 = createWorkflowStepId('step-1');
  const step2 = createWorkflowStepId('step-2');
  const step3 = createWorkflowStepId('step-3');

  const workflow = {
    metadata: { name: 'test-workflow' },
    transitions: new Map([[step1, new Set([step2])]]),
  };

  it('allows a transition with no next step', () => {
    expect(() =>
      validator.validate(workflow as never, step1, undefined),
    ).not.toThrow();
  });

  it('allows a declared transition', () => {
    expect(() =>
      validator.validate(workflow as never, step1, step2),
    ).not.toThrow();
  });

  it('rejects a transition to a step not declared as reachable', () => {
    expect(() => validator.validate(workflow as never, step1, step3)).toThrow(
      WorkflowExecutionError,
    );
  });

  it('rejects any transition from a step with no declared transitions', () => {
    expect(() => validator.validate(workflow as never, step2, step3)).toThrow(
      /cannot transition/,
    );
  });
});
