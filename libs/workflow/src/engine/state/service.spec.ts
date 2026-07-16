import { WorkflowStateService } from './service';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const store = {
    insert: jest.fn(),
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
    load: jest.fn(),
    findByCorrelationId: jest.fn(),
    findActive: jest.fn(),
    findByParentWorkflowId: jest.fn(),
    delete: jest.fn(),
  };
  const validator = { validate: jest.fn() };
  const registry = { get: jest.fn() };
  const publisher = { expired: jest.fn(), cancelled: jest.fn() };
  const logger = { cancelled: jest.fn() };
  const transitions = {
    cancelWorkflow: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        status: 'cancelled',
      }),
    ),
  };
  const history = { delete: jest.fn() };
  const signals = { deleteByWorkflowId: jest.fn() };
  const leaseService = { release: jest.fn() };
  const idempotency = { deleteByWorkflowId: jest.fn() };

  let afterCommitCallback: (() => Promise<void>) | undefined;
  const transactionRunner = {
    isActive: jest.fn().mockReturnValue(false),
    execute: jest.fn((operation: () => Promise<unknown>) => operation()),
    executeOrJoin: jest.fn((operation: () => Promise<unknown>) => operation()),
    afterCommit: jest.fn((callback: () => Promise<void>) => {
      afterCommitCallback = callback;
    }),
  };

  const service = new WorkflowStateService(
    store,
    validator,
    registry as never,
    publisher as never,
    logger as never,
    transitions as never,
    history as never,
    signals as never,
    leaseService as never,
    idempotency as never,
    transactionRunner as never,
  );

  return {
    service,
    store,
    validator,
    registry,
    publisher,
    transactionRunner,
    leaseService,
    history,
    signals,
    idempotency,
    getAfterCommitCallback: () => afterCommitCallback,
  };
}

describe('WorkflowStateService', () => {
  describe('save', () => {
    it('increments stateVersion relative to the previous state', async () => {
      const { service, store } = setup();
      const previous = createWorkflowExecutionState({ stateVersion: 4 });
      const next = createWorkflowExecutionState({
        stateVersion: 4,
        updatedAt: new Date(previous.updatedAt.getTime() + 1000),
      });

      await service.save(previous, next);

      const [, versioned] = store.save.mock.calls[0]!;
      expect(versioned.stateVersion).toBe(5);
    });

    it('preserves updatedAt when it is newer than the previous state', async () => {
      const { service, store } = setup();
      const previous = createWorkflowExecutionState();
      const newerDate = new Date(previous.updatedAt.getTime() + 5000);
      const next = createWorkflowExecutionState({ updatedAt: newerDate });

      await service.save(previous, next);

      const [, versioned] = store.save.mock.calls[0]!;
      expect(versioned.updatedAt).toBe(newerDate);
    });

    it('substitutes the current time when updatedAt has not advanced (clock skew)', async () => {
      const { service, store } = setup();
      const previous = createWorkflowExecutionState();
      const next = createWorkflowExecutionState({
        updatedAt: previous.updatedAt,
      });

      await service.save(previous, next);

      const [, versioned] = store.save.mock.calls[0]!;
      expect(versioned.updatedAt.getTime()).toBeGreaterThan(
        previous.updatedAt.getTime(),
      );
    });

    it('wraps the save in a transaction when none is active', async () => {
      const { service, store, transactionRunner } = setup();
      transactionRunner.isActive.mockReturnValue(false);
      const state = createWorkflowExecutionState();

      await service.save(state, state);

      expect(transactionRunner.execute).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('saves directly without wrapping when a transaction is already active', async () => {
      const { service, store, transactionRunner } = setup();
      transactionRunner.isActive.mockReturnValue(true);
      const state = createWorkflowExecutionState();

      await service.save(state, state);

      expect(transactionRunner.execute).not.toHaveBeenCalled();
      expect(store.save).toHaveBeenCalledTimes(1);
    });

    it('validates the versioned state before persisting', async () => {
      const { service, validator } = setup();
      const state = createWorkflowExecutionState();

      await service.save(state, state);

      expect(validator.validate).toHaveBeenCalledWith(
        expect.objectContaining({ stateVersion: state.stateVersion + 1 }),
      );
    });
  });

  describe('reload', () => {
    it('throws when the workflow no longer exists', async () => {
      const { service, store } = setup();
      store.load.mockResolvedValue(null);

      await expect(
        service.reload(createWorkflowExecutionState()),
      ).rejects.toThrow(WorkflowExecutionError);
    });

    it('returns the freshly loaded state', async () => {
      const { service, store } = setup();
      const latest = createWorkflowExecutionState({ stateVersion: 9 });
      store.load.mockResolvedValue(latest);

      const result = await service.reload(createWorkflowExecutionState());

      expect(result).toBe(latest);
    });
  });

  describe('delete', () => {
    it('proceeds with deletion even when lease release fails', async () => {
      const { service, store, leaseService } = setup();
      leaseService.release.mockRejectedValue(new Error('lease gone'));

      await expect(service.delete('workflow-1')).resolves.toBeUndefined();

      expect(store.delete).toHaveBeenCalledWith('workflow-1');
    });

    it('deletes history, signals, and idempotency records alongside state', async () => {
      const { service, store, history, signals, idempotency } = setup();

      await service.delete('workflow-1');

      expect(history.delete).toHaveBeenCalledWith('workflow-1');
      expect(signals.deleteByWorkflowId).toHaveBeenCalledWith('workflow-1');
      expect(idempotency.deleteByWorkflowId).toHaveBeenCalledWith('workflow-1');
      expect(store.delete).toHaveBeenCalledWith('workflow-1');
    });
  });

  describe('cancel', () => {
    it('publishes an expired event instead of cancelled when expired=true', async () => {
      const { service, store, registry, publisher, getAfterCommitCallback } =
        setup();
      const state = createWorkflowExecutionState();
      store.load.mockResolvedValue(state);
      registry.get.mockReturnValue({ metadata: { name: 'wf' } });

      await service.cancel('workflow-1', true);
      await getAfterCommitCallback()?.();

      expect(publisher.expired).toHaveBeenCalledTimes(1);
      expect(publisher.cancelled).not.toHaveBeenCalled();
    });

    it('publishes a cancelled event when expired=false', async () => {
      const { service, store, registry, publisher, getAfterCommitCallback } =
        setup();
      const state = createWorkflowExecutionState();
      store.load.mockResolvedValue(state);
      registry.get.mockReturnValue({ metadata: { name: 'wf' } });

      await service.cancel('workflow-1', false);
      await getAfterCommitCallback()?.();

      expect(publisher.cancelled).toHaveBeenCalledTimes(1);
      expect(publisher.expired).not.toHaveBeenCalled();
    });

    it('throws when the workflow to cancel does not exist', async () => {
      const { service, store } = setup();
      store.load.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(
        WorkflowExecutionError,
      );
    });
  });
});
