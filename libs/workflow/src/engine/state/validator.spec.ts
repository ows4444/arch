import { WorkflowStateValidator } from './validator';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { createWorkflowStepId } from '../../models/workflow-step-id';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

describe('WorkflowStateValidator', () => {
  const validator = new WorkflowStateValidator();

  it('rejects a negative stateVersion regardless of status', () => {
    const state = createWorkflowExecutionState({ stateVersion: -1 });

    expect(() => validator.validate(state)).toThrow(WorkflowExecutionError);
  });

  describe('running', () => {
    it('accepts a well-formed running state', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        currentStep: createWorkflowStepId('step-1'),
      });

      expect(() => validator.validate(state)).not.toThrow();
    });

    it('rejects a running state with waitingSince set', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        waitingSince: new Date(),
      });

      expect(() => validator.validate(state)).toThrow(
        /cannot have waitingSince/,
      );
    });

    it('rejects executingStep without stepStartedAt', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        executingStep: createWorkflowStepId('step-1'),
        stepStartedAt: undefined,
      });

      expect(() => validator.validate(state)).toThrow(
        /executingStep without stepStartedAt/,
      );
    });

    it('rejects stepStartedAt without executingStep', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        executingStep: undefined,
        stepStartedAt: new Date(),
      });

      expect(() => validator.validate(state)).toThrow(
        /stepStartedAt without executingStep/,
      );
    });

    it('accepts a running workflow with no current step (steps exhausted, awaiting completion)', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        currentStep: undefined,
      });

      expect(() => validator.validate(state)).not.toThrow();
    });

    it('rejects a running workflow with completedAt set', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        currentStep: createWorkflowStepId('step-1'),
        completedAt: new Date(),
      });

      expect(() => validator.validate(state)).toThrow(
        /cannot have completedAt/,
      );
    });
  });

  describe('waiting', () => {
    const waitingBase = () =>
      createWorkflowExecutionState({
        status: 'waiting',
        currentStep: undefined,
        waitingForSignal: { name: 'approval', signalId: 'signal-1' },
        waitingSince: new Date(),
        resumeStep: createWorkflowStepId('step-2'),
      });

    it('accepts a well-formed waiting state', () => {
      expect(() => validator.validate(waitingBase())).not.toThrow();
    });

    it('rejects waiting without a signal', () => {
      const state = { ...waitingBase(), waitingForSignal: undefined };

      expect(() => validator.validate(state)).toThrow(/has no signal/);
    });

    it('rejects waiting without waitingSince', () => {
      const state = { ...waitingBase(), waitingSince: undefined };

      expect(() => validator.validate(state)).toThrow(/missing waitingSince/);
    });

    it('rejects waiting without a resume step', () => {
      const state = { ...waitingBase(), resumeStep: undefined };

      expect(() => validator.validate(state)).toThrow(/no resume step/);
    });

    it('rejects waiting while still executing a step', () => {
      const state = {
        ...waitingBase(),
        executingStep: createWorkflowStepId('step-1'),
      };

      expect(() => validator.validate(state)).toThrow(/still executing step/);
    });
  });

  describe('completed', () => {
    const completedBase = () =>
      createWorkflowExecutionState({
        status: 'completed',
        currentStep: undefined,
        completedAt: new Date(),
      });

    it('accepts a well-formed completed state', () => {
      expect(() => validator.validate(completedBase())).not.toThrow();
    });

    it('rejects completed without completedAt', () => {
      const state = { ...completedBase(), completedAt: undefined };

      expect(() => validator.validate(state)).toThrow(/missing completedAt/);
    });

    it('rejects completed with a currentStep still set', () => {
      const state = {
        ...completedBase(),
        currentStep: createWorkflowStepId('step-1'),
      };

      expect(() => validator.validate(state)).toThrow(
        /cannot have currentStep/,
      );
    });
  });

  describe('failed', () => {
    const failedBase = () =>
      createWorkflowExecutionState({
        status: 'failed',
        currentStep: undefined,
        lastFailure: { code: 'E', message: 'm', retriable: false },
        failedAt: new Date(),
        failedStep: 'step-1',
      });

    it('accepts a well-formed failed state', () => {
      expect(() => validator.validate(failedBase())).not.toThrow();
    });

    it('rejects failed without lastFailure', () => {
      const state = { ...failedBase(), lastFailure: undefined };

      expect(() => validator.validate(state)).toThrow(/missing lastFailure/);
    });

    it('rejects failed without failedStep', () => {
      const state = { ...failedBase(), failedStep: undefined };

      expect(() => validator.validate(state)).toThrow(/missing failedStep/);
    });
  });

  describe('cancelled', () => {
    it('accepts a well-formed cancelled state', () => {
      const state = createWorkflowExecutionState({
        status: 'cancelled',
        currentStep: undefined,
      });

      expect(() => validator.validate(state)).not.toThrow();
    });

    it('rejects cancelled while still executing a step', () => {
      const state = createWorkflowExecutionState({
        status: 'cancelled',
        currentStep: undefined,
        executingStep: createWorkflowStepId('step-1'),
      });

      expect(() => validator.validate(state)).toThrow(/still executing/);
    });
  });
});
