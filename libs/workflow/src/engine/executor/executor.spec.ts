import { WorkflowExecutor } from './executor';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const registry = {
    getLatest: jest
      .fn()
      .mockReturnValue({ metadata: { name: 'test-workflow' } }),
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
  };
  const signalProcessor = {
    prepare: jest.fn(),
    complete: jest.fn(),
    pending: jest.fn().mockResolvedValue([]),
  };
  const completionService = {
    completeIfFinished: jest.fn((state: WorkflowExecutionState) =>
      Promise.resolve({ state, completed: false }),
    ),
  };
  const publisher = { signalled: jest.fn() };
  const logger = { signalReceived: jest.fn() };
  const lifecycle = { resume: jest.fn(), create: jest.fn() };
  const runner = { run: jest.fn() };
  const transactionRunner = {
    execute: jest.fn((operation: () => unknown) => operation()),
    executeOrJoin: jest.fn((operation: () => unknown) => operation()),
    afterCommit: jest.fn((callback: () => Promise<void>) => callback()),
  };
  const leaseService = { acquire: jest.fn(), release: jest.fn() };
  const stateService = {
    load: jest.fn(),
    cancel: jest.fn(),
    wake: jest.fn(),
    resumeJoin: jest.fn(),
    findByParentWorkflowId: jest.fn(),
    setPendingEffect: jest.fn(
      (
        state: WorkflowExecutionState,
        pendingEffect: unknown,
      ): Promise<WorkflowExecutionState> =>
        Promise.resolve({ ...state, pendingEffect } as WorkflowExecutionState),
    ),
    clearPendingEffect: jest.fn().mockResolvedValue(undefined),
  };
  const failureService = { failExecution: jest.fn(), handleFailure: jest.fn() };
  const idempotency = { release: jest.fn() };
  const children = { cancelChildren: jest.fn() };

  const executor = new WorkflowExecutor(
    registry as never,
    signalProcessor as never,
    completionService as never,
    publisher as never,
    logger as never,
    lifecycle as never,
    runner as never,
    transactionRunner as never,
    leaseService as never,
    stateService as never,
    failureService as never,
    idempotency as never,
    children as never,
  );

  return {
    executor,
    registry,
    signalProcessor,
    completionService,
    publisher,
    lifecycle,
    runner,
    transactionRunner,
    leaseService,
    stateService,
    failureService,
    idempotency,
    children,
  };
}

describe('WorkflowExecutor', () => {
  describe('execute', () => {
    it('creates, runs, and finalizes a new workflow, releasing the lease afterward', async () => {
      const { executor, lifecycle, runner, leaseService, stateService } =
        setup();
      const workflow = { metadata: { name: 'test-workflow' } };
      const initialState = createWorkflowExecutionState();
      const finalState = createWorkflowExecutionState({ status: 'completed' });

      lifecycle.create.mockResolvedValue({ workflow, state: initialState });
      runner.run.mockResolvedValue(finalState);
      stateService.load.mockResolvedValue(finalState);

      const result = await executor.execute('test-workflow', {});

      expect(leaseService.acquire).toHaveBeenCalledWith(
        initialState.workflowId,
      );
      expect(leaseService.release).toHaveBeenCalledWith(
        initialState.workflowId,
      );
      expect(result.workflowId).toBe(finalState.workflowId);
    });

    it('reports the failure and releases the lease when the runner throws', async () => {
      const {
        executor,
        lifecycle,
        runner,
        leaseService,
        failureService,
        stateService,
      } = setup();
      const workflow = { metadata: { name: 'test-workflow' } };
      const initialState = createWorkflowExecutionState();
      const error = new Error('step blew up');

      lifecycle.create.mockResolvedValue({ workflow, state: initialState });
      runner.run.mockRejectedValue(error);
      stateService.load.mockResolvedValue(null);

      await expect(executor.execute('test-workflow', {})).rejects.toThrow(
        error,
      );

      expect(failureService.handleFailure).toHaveBeenCalledWith(
        initialState,
        error,
      );
      expect(leaseService.release).toHaveBeenCalledWith(
        initialState.workflowId,
      );
    });
  });

  describe('resume', () => {
    it('resumes and finalizes the workflow', async () => {
      const { executor, lifecycle, runner, stateService } = setup();
      const workflow = { metadata: { name: 'test-workflow' } };
      const state = createWorkflowExecutionState({ status: 'running' });
      const finalState = createWorkflowExecutionState({ status: 'completed' });

      lifecycle.resume.mockResolvedValue({ workflow, state });
      runner.run.mockResolvedValue(finalState);
      stateService.load.mockResolvedValue(finalState);

      const result = await executor.resume(state.workflowId);

      expect(result.status).toBe('completed');
    });

    it('reports the failure via failExecution and rethrows when the runner throws', async () => {
      const { executor, lifecycle, runner, failureService, stateService } =
        setup();
      const workflow = { metadata: { name: 'test-workflow' } };
      const state = createWorkflowExecutionState({ status: 'running' });
      const error = new Error('step blew up');

      lifecycle.resume.mockResolvedValue({ workflow, state });
      runner.run.mockRejectedValue(error);
      stateService.load.mockResolvedValue(null);

      await expect(executor.resume(state.workflowId)).rejects.toThrow(error);

      expect(failureService.failExecution).toHaveBeenCalledWith(state, error);
    });
  });

  describe('wake', () => {
    it('wakes and finalizes the workflow', async () => {
      const { executor, runner, stateService } = setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const finalState = createWorkflowExecutionState({ status: 'completed' });

      stateService.wake.mockResolvedValue(state);
      runner.run.mockResolvedValue(finalState);
      stateService.load.mockResolvedValue(finalState);

      const result = await executor.wake(state.workflowId);

      expect(stateService.wake).toHaveBeenCalledWith(state.workflowId);
      expect(result.status).toBe('completed');
    });

    it('reports the failure via handleFailure and rethrows when the runner throws', async () => {
      const { executor, runner, failureService, stateService } = setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const error = new Error('step blew up');

      stateService.wake.mockResolvedValue(state);
      runner.run.mockRejectedValue(error);
      stateService.load.mockResolvedValue(null);

      await expect(executor.wake(state.workflowId)).rejects.toThrow(error);

      expect(failureService.handleFailure).toHaveBeenCalledWith(state, error);
    });
  });

  describe('resumeJoin', () => {
    it('resumes the join and finalizes the workflow', async () => {
      const { executor, runner, stateService } = setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const finalState = createWorkflowExecutionState({ status: 'completed' });

      stateService.resumeJoin.mockResolvedValue(state);
      runner.run.mockResolvedValue(finalState);
      stateService.load.mockResolvedValue(finalState);

      const result = await executor.resumeJoin(state.workflowId);

      expect(stateService.resumeJoin).toHaveBeenCalledWith(state.workflowId);
      expect(result.status).toBe('completed');
    });

    it('reports the failure via handleFailure and rethrows when the runner throws', async () => {
      const { executor, runner, failureService, stateService } = setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const error = new Error('step blew up');

      stateService.resumeJoin.mockResolvedValue(state);
      runner.run.mockRejectedValue(error);
      stateService.load.mockResolvedValue(null);

      await expect(executor.resumeJoin(state.workflowId)).rejects.toThrow(
        error,
      );

      expect(failureService.handleFailure).toHaveBeenCalledWith(state, error);
    });
  });

  describe('cancel', () => {
    it('delegates to stateService.cancel and maps the result', async () => {
      const { executor, stateService } = setup();
      const cancelled = createWorkflowExecutionState({ status: 'cancelled' });
      stateService.cancel.mockResolvedValue(cancelled);

      const result = await executor.cancel('workflow-1', true);

      expect(stateService.cancel).toHaveBeenCalledWith('workflow-1', true);
      expect(result.status).toBe('cancelled');
    });

    it('cancels managed child workflows after the cancellation commits', async () => {
      const { executor, stateService, children } = setup();
      const cancelled = createWorkflowExecutionState({ status: 'cancelled' });
      stateService.cancel.mockResolvedValue(cancelled);

      await executor.cancel('workflow-1');

      expect(children.cancelChildren).toHaveBeenCalledWith(
        { metadata: { name: 'test-workflow' } },
        { ...cancelled, pendingEffect: { type: 'cancel-children' } },
      );
      expect(stateService.clearPendingEffect).toHaveBeenCalledWith(
        cancelled.workflowId,
      );
    });
  });

  describe('signal', () => {
    it('processes a signal to completion and publishes signalled after commit', async () => {
      const { executor, signalProcessor, runner, publisher, stateService } =
        setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const finalState = createWorkflowExecutionState({ status: 'completed' });

      signalProcessor.prepare.mockResolvedValue({ state, acquired: true });
      runner.run.mockResolvedValue(finalState);
      stateService.load.mockResolvedValue(finalState);

      const result = await executor.signal(state.workflowId, {
        name: 'approval',
        signalId: 'signal-1',
      });

      expect(result.status).toBe('completed');
      expect(publisher.signalled).toHaveBeenCalledTimes(1);
      expect(signalProcessor.complete).toHaveBeenCalledWith(
        state.workflowId,
        'signal-1',
      );
    });

    it('chains to the next pending signal when the workflow re-enters waiting', async () => {
      const { executor, signalProcessor, runner, stateService } = setup();
      const waitingState = createWorkflowExecutionState({ status: 'waiting' });
      const completedState = createWorkflowExecutionState({
        status: 'completed',
      });

      signalProcessor.prepare
        .mockResolvedValueOnce({
          state: createWorkflowExecutionState({ status: 'running' }),
          acquired: true,
        })
        .mockResolvedValueOnce({
          state: createWorkflowExecutionState({ status: 'waiting' }),
          acquired: true,
        });

      runner.run
        .mockResolvedValueOnce(waitingState)
        .mockResolvedValueOnce(completedState);

      stateService.load
        .mockResolvedValueOnce(waitingState)
        .mockResolvedValueOnce(completedState);

      signalProcessor.pending.mockResolvedValueOnce([
        { signal: { name: 'second', signalId: 'signal-2' } },
      ]);

      const result = await executor.signal(waitingState.workflowId, {
        name: 'first',
        signalId: 'signal-1',
      });

      expect(runner.run).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('completed');
    });

    it('releases the idempotency key and rethrows when the runner fails after acquiring', async () => {
      const { executor, signalProcessor, runner, idempotency, stateService } =
        setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      const error = new Error('handler exploded');

      signalProcessor.prepare.mockResolvedValue({ state, acquired: true });
      runner.run.mockRejectedValue(error);
      stateService.load.mockResolvedValue(null);

      await expect(
        executor.signal(state.workflowId, {
          name: 'approval',
          signalId: 'signal-1',
        }),
      ).rejects.toThrow(error);

      expect(idempotency.release).toHaveBeenCalledWith(
        expect.stringContaining('signal-1'),
      );
    });
  });
});
