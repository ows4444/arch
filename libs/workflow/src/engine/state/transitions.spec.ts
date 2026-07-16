import { WorkflowStateTransitions } from './transitions';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { createWorkflowStepId } from '../../models/workflow-step-id';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

describe('WorkflowStateTransitions', () => {
  let transitions: WorkflowStateTransitions;

  beforeEach(() => {
    transitions = new WorkflowStateTransitions();
  });

  describe('startStep', () => {
    it('sets currentStep, executingStep and stepStartedAt', () => {
      const state = createWorkflowExecutionState();
      const startedAt = new Date('2026-01-01T00:01:00.000Z');
      const step = createWorkflowStepId('step-2');

      const next = transitions.startStep(state, step, startedAt);

      expect(next.currentStep).toBe(step);
      expect(next.executingStep).toBe(step);
      expect(next.stepStartedAt).toBe(startedAt);
    });

    it('clears recovery context', () => {
      const state = createWorkflowExecutionState({
        requiresRecovery: true,
        recoveryReason: 'timeout',
        retryAt: new Date(),
      });

      const next = transitions.startStep(state, createWorkflowStepId('s'));

      expect(next.requiresRecovery).toBe(false);
      expect(next.recoveryReason).toBeUndefined();
      expect(next.retryAt).toBeUndefined();
    });
  });

  describe('completeWorkflow', () => {
    it('marks status completed and clears execution context', () => {
      const state = createWorkflowExecutionState({
        status: 'running',
        executingStep: createWorkflowStepId('step-1'),
        stepRetryCount: 3,
      });

      const next = transitions.completeWorkflow(state);

      expect(next.status).toBe('completed');
      expect(next.currentStep).toBeUndefined();
      expect(next.executingStep).toBeUndefined();
      expect(next.stepRetryCount).toBe(0);
      expect(next.completedAt).toBeInstanceOf(Date);
    });
  });

  describe('failWorkflow', () => {
    it('increments failureCount and records the executing step as failedStep', () => {
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
        failureCount: 2,
      });

      const next = transitions.failWorkflow(state, {
        code: 'ERR',
        message: 'boom',
        retriable: true,
      });

      expect(next.status).toBe('failed');
      expect(next.failureCount).toBe(3);
      expect(next.failedStep).toBe('step-1');
      expect(next.lastFailure).toEqual({
        code: 'ERR',
        message: 'boom',
        retriable: true,
      });
    });

    it('defaults failureCount to 1 when previously unset', () => {
      const state = createWorkflowExecutionState({ failureCount: undefined });

      const next = transitions.failWorkflow(state, {
        code: 'ERR',
        message: 'boom',
        retriable: false,
      });

      expect(next.failureCount).toBe(1);
    });
  });

  describe('resetForRetry', () => {
    it('throws when the workflow is not in failed status', () => {
      const state = createWorkflowExecutionState({ status: 'running' });

      expect(() => transitions.resetForRetry(state)).toThrow(
        WorkflowExecutionError,
      );
    });

    it('throws when failedStep is missing', () => {
      const state = createWorkflowExecutionState({
        status: 'failed',
        failedStep: undefined,
      });

      expect(() => transitions.resetForRetry(state)).toThrow(
        WorkflowExecutionError,
      );
    });

    it('resets status to running and resumes at the failed step', () => {
      const state = createWorkflowExecutionState({
        status: 'failed',
        failedStep: 'step-3',
        failedAt: new Date(),
        stepRetryCount: 5,
      });

      const next = transitions.resetForRetry(state);

      expect(next.status).toBe('running');
      expect(next.currentStep).toBe('step-3');
      expect(next.stepRetryCount).toBe(0);
      expect(next.failedAt).toBeUndefined();
    });
  });

  describe('completeStep', () => {
    const execution = {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date(),
      status: 'completed' as const,
    };

    it('merges returned data into existing state data', () => {
      const state = createWorkflowExecutionState({
        data: { a: 1 },
      });

      const next = transitions.completeStep(
        state,
        execution,
        createWorkflowStepId('step-2'),
        undefined,
        { b: 2 },
      );

      expect(next.data).toEqual({ a: 1, b: 2 });
      expect(next.historyCount).toBe(state.historyCount + 1);
      expect(next.iteration).toBe(state.iteration + 1);
    });

    it('transitions to waiting status when a signal is required', () => {
      const state = createWorkflowExecutionState();
      const signal = { name: 'approval', signalId: 'signal-1' };

      const next = transitions.completeStep(
        state,
        execution,
        createWorkflowStepId('step-2'),
        signal,
      );

      expect(next.status).toBe('waiting');
      expect(next.waitingForSignal).toBe(signal);
      expect(next.resumeStep).toBe('step-2');
    });

    it('leaves data untouched when no data is returned', () => {
      const state = createWorkflowExecutionState({ data: { a: 1 } });

      const next = transitions.completeStep(state, execution);

      expect(next.data).toBe(state.data);
    });
  });
});
