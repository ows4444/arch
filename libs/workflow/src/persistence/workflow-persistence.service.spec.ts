import { WorkflowPersistenceService } from './workflow-persistence.service';
import { createWorkflowExecutionState } from '../testing/fixtures/state.factory';

function setup() {
  const snapshotStore = {
    load: jest.fn(),
    snapshot: jest.fn().mockResolvedValue(undefined),
  };
  const service = new WorkflowPersistenceService(snapshotStore);

  return { service, snapshotStore };
}

function workflow(snapshotEvery?: number) {
  return {
    metadata: {
      persistence: snapshotEvery !== undefined ? { snapshotEvery } : undefined,
    },
  } as never;
}

describe('WorkflowPersistenceService.shouldSnapshot', () => {
  const { service } = setup();

  it('returns false when the workflow has no persistence config', () => {
    const state = createWorkflowExecutionState({ historyCount: 5 });

    expect(service.shouldSnapshot(workflow(undefined), state)).toBe(false);
  });

  it('returns false when snapshotEvery is zero or negative', () => {
    const state = createWorkflowExecutionState({ historyCount: 5 });

    expect(service.shouldSnapshot(workflow(0), state)).toBe(false);
  });

  it('returns false when historyCount has not reached snapshotEvery', () => {
    const state = createWorkflowExecutionState({ historyCount: 2 });

    expect(service.shouldSnapshot(workflow(5), state)).toBe(false);
  });

  it('returns false when historyCount is zero (nothing to snapshot yet)', () => {
    const state = createWorkflowExecutionState({ historyCount: 0 });

    expect(service.shouldSnapshot(workflow(5), state)).toBe(false);
  });

  it('returns true when historyCount is an exact multiple of snapshotEvery', () => {
    const state = createWorkflowExecutionState({ historyCount: 10 });

    expect(service.shouldSnapshot(workflow(5), state)).toBe(true);
  });
});

describe('WorkflowPersistenceService.snapshot', () => {
  it('writes a snapshot when shouldSnapshot is true', async () => {
    const { service, snapshotStore } = setup();
    const state = createWorkflowExecutionState({ historyCount: 5 });
    const wf = workflow(5);

    await service.snapshot(wf, state);

    expect(snapshotStore.snapshot).toHaveBeenCalledWith(wf, state);
  });

  it('does not write when shouldSnapshot is false', async () => {
    const { service, snapshotStore } = setup();
    const state = createWorkflowExecutionState({ historyCount: 2 });

    await service.snapshot(workflow(5), state);

    expect(snapshotStore.snapshot).not.toHaveBeenCalled();
  });
});

describe('WorkflowPersistenceService.recoverSnapshot', () => {
  it('returns null when no snapshot exists', async () => {
    const { service, snapshotStore } = setup();
    snapshotStore.load.mockResolvedValue(null);
    const current = createWorkflowExecutionState();

    await expect(service.recoverSnapshot(current)).resolves.toBeNull();
  });

  it('returns null when the snapshot belongs to a different workflow', async () => {
    const { service, snapshotStore } = setup();
    const current = createWorkflowExecutionState({ workflowId: 'wf-1' });
    snapshotStore.load.mockResolvedValue(
      createWorkflowExecutionState({ workflowId: 'wf-2' }),
    );

    await expect(service.recoverSnapshot(current)).resolves.toBeNull();
  });

  it('returns null when the snapshot is older than the current state version', async () => {
    const { service, snapshotStore } = setup();
    const current = createWorkflowExecutionState({ stateVersion: 5 });
    snapshotStore.load.mockResolvedValue(
      createWorkflowExecutionState({ stateVersion: 3 }),
    );

    await expect(service.recoverSnapshot(current)).resolves.toBeNull();
  });

  it('returns null when the snapshot has less history than the current state', async () => {
    const { service, snapshotStore } = setup();
    const current = createWorkflowExecutionState({
      stateVersion: 1,
      historyCount: 10,
    });
    snapshotStore.load.mockResolvedValue(
      createWorkflowExecutionState({ stateVersion: 1, historyCount: 3 }),
    );

    await expect(service.recoverSnapshot(current)).resolves.toBeNull();
  });

  it('returns the snapshot when it is at least as advanced as the current state', async () => {
    const { service, snapshotStore } = setup();
    const current = createWorkflowExecutionState({
      stateVersion: 1,
      historyCount: 3,
    });
    const snapshot = createWorkflowExecutionState({
      stateVersion: 2,
      historyCount: 5,
    });
    snapshotStore.load.mockResolvedValue(snapshot);

    await expect(service.recoverSnapshot(current)).resolves.toBe(snapshot);
  });
});

describe('WorkflowPersistenceService.loadSnapshot', () => {
  it('delegates to the snapshot store', async () => {
    const { service, snapshotStore } = setup();
    const snapshot = createWorkflowExecutionState();
    snapshotStore.load.mockResolvedValue(snapshot);

    await expect(service.loadSnapshot('wf-1')).resolves.toBe(snapshot);
    expect(snapshotStore.load).toHaveBeenCalledWith('wf-1');
  });
});
