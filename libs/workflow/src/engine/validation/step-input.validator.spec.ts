import { WorkflowStepInputValidator } from './step-input.validator';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { createWorkflowStepId } from '../../models/workflow-step-id';
import type { WorkflowStepInputSpecification } from '../../definition/workflow-step-input-specification';

function spec(satisfied: boolean): WorkflowStepInputSpecification<unknown> {
  return {
    name: 'TestSpec',
    isSatisfiedBy: () => satisfied,
    explain: () => (satisfied ? [] : ['data was invalid']),
  };
}

describe('WorkflowStepInputValidator.validate', () => {
  const validator = new WorkflowStepInputValidator();
  const currentStep = createWorkflowStepId('step-1');

  it('resolves when no inputSpec is configured', async () => {
    await expect(
      validator.validate(currentStep, undefined, { any: 'data' }),
    ).resolves.toBeUndefined();
  });

  it('resolves when the inputSpec is satisfied', async () => {
    await expect(
      validator.validate(currentStep, spec(true), { any: 'data' }),
    ).resolves.toBeUndefined();
  });

  it('throws WorkflowExecutionError with the explanation when the inputSpec fails', async () => {
    await expect(
      validator.validate(currentStep, spec(false), { any: 'data' }),
    ).rejects.toThrow(WorkflowExecutionError);
    await expect(
      validator.validate(currentStep, spec(false), { any: 'data' }),
    ).rejects.toThrow(/data was invalid/);
  });

  it('supports an async specification', async () => {
    const asyncSpec: WorkflowStepInputSpecification<unknown> = {
      name: 'AsyncSpec',
      isSatisfiedBy: () => Promise.resolve(false),
      explain: () => Promise.resolve(['async failure']),
    };

    await expect(
      validator.validate(currentStep, asyncSpec, {}),
    ).rejects.toThrow(/async failure/);
  });
});
