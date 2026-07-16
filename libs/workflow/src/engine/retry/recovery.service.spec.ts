import { WorkflowRecoveryService } from './recovery.service';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowStepId } from '../../models/workflow-step-id';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const store = {
    findStuck: jest.fn(),
    findRecoverable: jest.fn(),
    findWaitingExpired: jest.fn(),
    load: jest.fn(),
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
  };
  const transitions = {
    markRecoverable: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        requiresRecovery: true,
      }),
    ),
  };
  const history = { findByWorkflowId: jest.fn().mockResolvedValue([]) };

  const service = new WorkflowRecoveryService(
    store as never,
    transitions as never,
    history as never,
  );

  return { service, store, transitions, history };
}

describe('WorkflowRecoveryService', () => {
  describe('validateRecoverable', () => {
    it('does nothing when the workflow is not mid-step', async () => {
      const { service, history } = setup();
      const state = createWorkflowExecutionState({ executingStep: undefined });

      await expect(service.validateRecoverable(state)).resolves.toBeUndefined();
      expect(history.findByWorkflowId).not.toHaveBeenCalled();
    });

    it('throws when no started history record exists for the executing step', async () => {
      const { service, history } = setup();
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });
      history.findByWorkflowId.mockResolvedValue([]);

      await expect(service.validateRecoverable(state)).rejects.toThrow(
        /no started record exists/,
      );
    });

    it('throws when the executing step already completed', async () => {
      const { service, history } = setup();
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });
      history.findByWorkflowId.mockResolvedValue([
        { step: 'step-1', status: 'started' },
        { step: 'step-1', status: 'completed' },
      ]);

      await expect(service.validateRecoverable(state)).rejects.toThrow(
        /already completed/,
      );
    });

    it('passes when the step started but has not completed', async () => {
      const { service, history } = setup();
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });
      history.findByWorkflowId.mockResolvedValue([
        { step: 'step-1', status: 'started' },
      ]);

      await expect(service.validateRecoverable(state)).resolves.toBeUndefined();
    });
  });

  describe('findStuckExecutions', () => {
    it('filters to running executions with an in-flight step that are not already flagged', async () => {
      const { service, store } = setup();

      store.findStuck.mockResolvedValue([
        createWorkflowExecutionState({
          workflowId: 'a',
          status: 'running',
          executingStep: createWorkflowStepId('s'),
          requiresRecovery: false,
        }),
        createWorkflowExecutionState({
          workflowId: 'b',
          status: 'waiting',
          executingStep: createWorkflowStepId('s'),
        }),
        createWorkflowExecutionState({
          workflowId: 'c',
          status: 'running',
          executingStep: undefined,
        }),
        createWorkflowExecutionState({
          workflowId: 'd',
          status: 'running',
          executingStep: createWorkflowStepId('s'),
          requiresRecovery: true,
        }),
      ]);

      const result = await service.findStuckExecutions();

      expect(result.map((x) => x.workflowId)).toEqual(['a']);
    });

    it('returns an empty array when the store does not implement findStuck', async () => {
      const { service, store } = setup();
      store.findStuck = undefined as never;

      await expect(service.findStuckExecutions()).resolves.toEqual([]);
    });
  });

  describe('markAsRecoverable', () => {
    it('throws when the workflow does not exist', async () => {
      const { service, store } = setup();
      store.load.mockResolvedValue(null);

      await expect(service.markAsRecoverable('workflow-1')).rejects.toThrow(
        WorkflowExecutionError,
      );
    });

    it('is a no-op when the workflow already requires recovery', async () => {
      const { service, store } = setup();
      store.load.mockResolvedValue(
        createWorkflowExecutionState({ requiresRecovery: true }),
      );

      await service.markAsRecoverable('workflow-1');

      expect(store.save).not.toHaveBeenCalled();
    });

    it('marks the workflow recoverable when it is not already flagged', async () => {
      const { service, store, transitions } = setup();
      const state = createWorkflowExecutionState({ requiresRecovery: false });
      store.load.mockResolvedValue(state);

      await service.markAsRecoverable('workflow-1');

      expect(transitions.markRecoverable).toHaveBeenCalledWith(
        state,
        'timeout',
      );
      expect(store.save).toHaveBeenCalledTimes(1);
    });
  });
});
