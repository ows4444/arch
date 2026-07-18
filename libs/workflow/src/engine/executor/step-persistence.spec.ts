import { WorkflowStepPersistenceService } from './step-persistence';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../models/workflow-step-id';

function setup() {
  const history = { append: jest.fn().mockResolvedValue(undefined) };
  const transitions = {
    startStep: jest.fn(
      (previous: WorkflowExecutionState): WorkflowExecutionState => ({
        ...previous,
        status: 'running',
      }),
    ),
    completeStep: jest.fn(
      (previous: WorkflowExecutionState): WorkflowExecutionState => ({
        ...previous,
        status: 'completed',
      }),
    ),
    incrementStepRetry: jest.fn(
      (previous: WorkflowExecutionState): WorkflowExecutionState => ({
        ...previous,
        stepRetryCount: (previous.stepRetryCount ?? 0) + 1,
      }),
    ),
  };
  const stateService = {
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
  };
  const persistence = { snapshot: jest.fn().mockResolvedValue(undefined) };

  const callOrder: string[] = [];
  const transactionRunner = {
    executeOrJoin: jest.fn(async (operation: () => unknown) => {
      callOrder.push('transaction-start');
      const result = await operation();
      callOrder.push('transaction-end');
      return result;
    }),
  };

  const service = new WorkflowStepPersistenceService(
    history as never,
    transitions as never,
    stateService as never,
    persistence as never,
    transactionRunner as never,
  );

  return {
    service,
    history,
    transitions,
    stateService,
    persistence,
    transactionRunner,
    callOrder,
  };
}

describe('WorkflowStepPersistenceService', () => {
  const step = createWorkflowStepId('step-1');
  const state = createWorkflowExecutionState();

  describe('startStep', () => {
    it('runs the transition, save, and history append inside one transaction', async () => {
      const { service, history, transitions, stateService, transactionRunner } =
        setup();
      const startedAt = new Date('2026-01-01T00:00:00.000Z');

      const result = await service.startStep(state, step, startedAt);

      expect(transactionRunner.executeOrJoin).toHaveBeenCalledTimes(1);
      expect(transitions.startStep).toHaveBeenCalledWith(
        state,
        step,
        startedAt,
      );
      expect(stateService.save).toHaveBeenCalledWith(
        state,
        expect.objectContaining({ status: 'running' }),
      );
      expect(history.append).toHaveBeenCalledWith(state.workflowId, {
        step,
        startedAt,
        status: 'started',
      });
      expect(result.status).toBe('running');
    });
  });

  describe('completeStep', () => {
    const workflow = { metadata: {} };
    const execution = {
      step,
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:00:05.000Z'),
      status: 'completed' as const,
    };

    it('appends history, saves the transitioned state, then attempts a snapshot', async () => {
      const { service, history, transitions, stateService, persistence } =
        setup();

      const result = await service.completeStep(
        workflow as never,
        state,
        execution,
        {},
      );

      expect(history.append).toHaveBeenCalledWith(state.workflowId, execution);
      expect(transitions.completeStep).toHaveBeenCalledWith(
        state,
        execution,
        undefined,
        undefined,
        undefined,
      );
      expect(stateService.save).toHaveBeenCalledWith(
        state,
        expect.objectContaining({ status: 'completed' }),
      );
      expect(persistence.snapshot).toHaveBeenCalledWith(
        workflow,
        expect.objectContaining({ status: 'completed' }),
      );
      expect(result.status).toBe('completed');
    });

    it('passes nextStep/waitForSignal/data through from the step result', async () => {
      const { service, transitions } = setup();

      await service.completeStep(workflow as never, state, execution, {
        nextStep: createWorkflowStepId('step-2'),
        waitForSignal: { name: 'approval', signalId: 'sig-1' },
        data: { approved: true },
      });

      expect(transitions.completeStep).toHaveBeenCalledWith(
        state,
        execution,
        createWorkflowStepId('step-2'),
        { name: 'approval', signalId: 'sig-1' },
        { approved: true },
      );
    });

    it('appends history before computing the transitioned state (write ordering)', async () => {
      const { service, history, transitions } = setup();
      const order: string[] = [];

      history.append.mockImplementation(() => {
        order.push('history.append');
        return Promise.resolve();
      });
      transitions.completeStep.mockImplementation(
        (previous: WorkflowExecutionState) => {
          order.push('transitions.completeStep');
          return { ...previous, status: 'completed' as const };
        },
      );

      await service.completeStep(workflow as never, state, execution, {});

      expect(order).toEqual(['history.append', 'transitions.completeStep']);
    });
  });

  describe('recordStepAttempt', () => {
    it('appends to history without opening a transaction', async () => {
      const { service, history, transactionRunner } = setup();
      const execution = {
        step,
        startedAt: new Date(),
        status: 'started' as const,
      };

      await service.recordStepAttempt(state.workflowId, execution);

      expect(history.append).toHaveBeenCalledWith(state.workflowId, execution);
      expect(transactionRunner.executeOrJoin).not.toHaveBeenCalled();
    });
  });

  describe('recordRetryAttempt', () => {
    it('appends history, increments the retry count, and saves inside one transaction', async () => {
      const { service, history, transitions, stateService, transactionRunner } =
        setup();
      const execution = {
        step,
        startedAt: new Date(),
        status: 'failed' as const,
        error: 'boom',
      };

      const result = await service.recordRetryAttempt(state, execution);

      expect(transactionRunner.executeOrJoin).toHaveBeenCalledTimes(1);
      expect(history.append).toHaveBeenCalledWith(state.workflowId, execution);
      expect(transitions.incrementStepRetry).toHaveBeenCalledWith(state);
      expect(stateService.save).toHaveBeenCalledWith(
        state,
        expect.objectContaining({ stepRetryCount: 1 }),
      );
      expect(result.stepRetryCount).toBe(1);
    });
  });

  describe('appendFailure', () => {
    it('appends to history without opening a transaction', async () => {
      const { service, history, transactionRunner } = setup();
      const execution = {
        step,
        startedAt: new Date(),
        status: 'failed' as const,
        error: 'boom',
      };

      await service.appendFailure(state.workflowId, execution);

      expect(history.append).toHaveBeenCalledWith(state.workflowId, execution);
      expect(transactionRunner.executeOrJoin).not.toHaveBeenCalled();
    });
  });
});
