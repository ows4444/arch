import { WorkflowLifecycleService } from './lifecycle.service';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const registry = {
    getLatest: jest.fn(),
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
    resolve: jest.fn(),
  };
  const stateFactory = { create: jest.fn() };
  const stateService = {
    insert: jest.fn(),
    load: jest.fn(),
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
  };
  const transitions = {
    clearRecovery: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        requiresRecovery: false,
      }),
    ),
    incrementRecoveryAttempts: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        recoveryAttempts: (state.recoveryAttempts ?? 0) + 1,
      }),
    ),
  };
  const publisher = { started: jest.fn() };
  const children = { startChildren: jest.fn() };
  const recovery = { validateRecoverable: jest.fn() };
  const persistence = { recoverSnapshot: jest.fn().mockResolvedValue(null) };
  const logger = { started: jest.fn(), recovered: jest.fn() };
  const transactionRunner = {
    afterCommit: jest.fn((callback: () => Promise<void>) => callback()),
  };

  const service = new WorkflowLifecycleService(
    registry as never,
    stateFactory,
    stateService as never,
    transitions as never,
    publisher as never,
    children as never,
    recovery as never,
    persistence as never,
    logger as never,
    transactionRunner as never,
  );

  return {
    service,
    registry,
    stateFactory,
    stateService,
    transitions,
    publisher,
    children,
    recovery,
    persistence,
    logger,
  };
}

describe('WorkflowLifecycleService', () => {
  describe('create', () => {
    it('inserts the new state and fires started/startChildren after commit', async () => {
      const {
        service,
        registry,
        stateFactory,
        stateService,
        publisher,
        children,
      } = setup();
      const workflow = { metadata: { name: 'test-workflow' } };
      const state = createWorkflowExecutionState();

      registry.resolve.mockReturnValue(workflow);
      stateFactory.create.mockReturnValue(state);

      const result = await service.create('test-workflow', {});

      expect(registry.resolve).toHaveBeenCalledWith('test-workflow', undefined);
      expect(stateService.insert).toHaveBeenCalledWith(state);
      expect(publisher.started).toHaveBeenCalledWith(workflow, state);
      expect(children.startChildren).toHaveBeenCalledWith(workflow, state);
      expect(result).toEqual({ workflow, state });
    });

    it('resolves a specific workflowVersion when passed via options', async () => {
      const { service, registry, stateFactory } = setup();
      const workflow = { metadata: { name: 'test-workflow', version: 2 } };
      const state = createWorkflowExecutionState();

      registry.resolve.mockReturnValue(workflow);
      stateFactory.create.mockReturnValue(state);

      await service.create('test-workflow', {}, { workflowVersion: 2 });

      expect(registry.resolve).toHaveBeenCalledWith('test-workflow', 2);
    });
  });

  describe('resume', () => {
    it('throws when the workflow does not exist', async () => {
      const { service, stateService } = setup();
      stateService.load.mockResolvedValue(null);

      await expect(service.resume('workflow-1')).rejects.toThrow(
        WorkflowExecutionError,
      );
    });

    it('throws when the workflow is waiting for a signal', async () => {
      const { service, stateService } = setup();
      stateService.load.mockResolvedValue(
        createWorkflowExecutionState({ status: 'waiting' }),
      );

      await expect(service.resume('workflow-1')).rejects.toThrow(
        /waiting for a signal/,
      );
    });

    it.each(['completed', 'failed', 'cancelled'] as const)(
      'throws when the workflow status is %s',
      async (status) => {
        const { service, stateService } = setup();
        stateService.load.mockResolvedValue(
          createWorkflowExecutionState({ status }),
        );

        await expect(service.resume('workflow-1')).rejects.toThrow(
          /cannot be resumed from status/,
        );
      },
    );

    it('throws when resumed before the scheduled retry time', async () => {
      const { service, stateService } = setup();
      stateService.load.mockResolvedValue(
        createWorkflowExecutionState({
          status: 'running',
          retryAt: new Date(Date.now() + 60_000),
        }),
      );

      await expect(service.resume('workflow-1')).rejects.toThrow(
        /cannot be resumed before its scheduled retry/,
      );
    });

    it('resumes a plain running workflow without touching recovery state', async () => {
      const { service, stateService, recovery, persistence } = setup();
      const state = createWorkflowExecutionState({ status: 'running' });
      stateService.load.mockResolvedValue(state);

      const result = await service.resume('workflow-1');

      expect(recovery.validateRecoverable).not.toHaveBeenCalled();
      expect(persistence.recoverSnapshot).not.toHaveBeenCalled();
      expect(result.state).toBe(state);
    });

    it('validates and restores from a snapshot when recovery is required', async () => {
      const { service, stateService, recovery, persistence, logger } = setup();
      const state = createWorkflowExecutionState({
        status: 'running',
        requiresRecovery: true,
      });
      const snapshot = createWorkflowExecutionState({
        status: 'running',
        stateVersion: 42,
      });
      stateService.load.mockResolvedValue(state);
      persistence.recoverSnapshot.mockResolvedValue(snapshot);

      const result = await service.resume('workflow-1');

      expect(recovery.validateRecoverable).toHaveBeenCalledWith(state);
      expect(result.state).toBe(snapshot);
      expect(logger.recovered).toHaveBeenCalledWith(snapshot);
    });

    it('falls back to clearing recovery state when no snapshot exists', async () => {
      const { service, stateService, persistence, transitions } = setup();
      const state = createWorkflowExecutionState({
        status: 'running',
        requiresRecovery: true,
      });
      stateService.load.mockResolvedValue(state);
      persistence.recoverSnapshot.mockResolvedValue(null);

      const result = await service.resume('workflow-1');

      expect(transitions.incrementRecoveryAttempts).toHaveBeenCalledWith(state);
      expect(transitions.clearRecovery).toHaveBeenCalledTimes(1);
      expect(result.state.requiresRecovery).toBe(false);
    });
  });
});
