import { WorkflowRetentionService } from './retention.service';
import { createWorkflowExecutionState } from '../testing/fixtures/state.factory';

function registeredWorkflow(
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return { metadata: { name, version: 1, ...overrides } };
}

function setup() {
  const registry = { getAll: jest.fn().mockReturnValue([]) };
  const stateService = {
    findCompleted: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const queryService = { get: jest.fn() };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };
  const metrics = { retentionDeleted: jest.fn(), retentionArchived: jest.fn() };
  const archiveStore = { archive: jest.fn().mockResolvedValue(undefined) };

  const service = new WorkflowRetentionService(
    registry as never,
    stateService as never,
    queryService as never,
    scheduler as never,
    metrics as never,
    archiveStore,
  );

  return {
    service,
    registry,
    stateService,
    queryService,
    scheduler,
    metrics,
    archiveStore,
  };
}

describe('WorkflowRetentionService.onModuleInit / onModuleDestroy', () => {
  it('schedules the cleanup interval at the minimum floor when no workflow configures retention', () => {
    const { service, scheduler } = setup();

    service.onModuleInit();

    expect(scheduler.addInterval).toHaveBeenCalledWith(
      'workflow-retention',
      expect.anything(),
    );
  });

  it('removes the interval on destroy without throwing if none was registered', () => {
    const { service, scheduler } = setup();

    expect(() => service.onModuleDestroy()).not.toThrow();
    expect(scheduler.deleteInterval).toHaveBeenCalledWith('workflow-retention');
  });
});

describe('WorkflowRetentionService.cleanup', () => {
  it('skips workflows without retention configured', async () => {
    const { service, registry, stateService } = setup();
    registry.getAll.mockReturnValue([registeredWorkflow('wf')]);

    await service.cleanup();

    expect(stateService.findCompleted).not.toHaveBeenCalled();
  });

  it('deletes each expired execution and reports the count via metrics', async () => {
    const { service, registry, stateService, metrics } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('wf', { retention: { ttlMs: 60_000 } }),
    ]);
    stateService.findCompleted.mockResolvedValue([
      createWorkflowExecutionState({ workflowId: 'wf-1' }),
    ]);

    await service.cleanup();

    expect(stateService.delete).toHaveBeenCalledWith('wf-1');
    expect(metrics.retentionDeleted).toHaveBeenCalledWith(1);
    expect(metrics.retentionArchived).toHaveBeenCalledWith(0);
  });

  it('archives before deleting when archiveBeforeDelete is set', async () => {
    const {
      service,
      registry,
      stateService,
      queryService,
      archiveStore,
      metrics,
    } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('wf', {
        retention: { ttlMs: 60_000, archiveBeforeDelete: true },
      }),
    ]);
    const execution = createWorkflowExecutionState({ workflowId: 'wf-1' });
    stateService.findCompleted.mockResolvedValue([execution]);
    const details = { state: execution, history: [], pendingSignals: [] };
    queryService.get.mockResolvedValue(details);

    await service.cleanup();

    expect(queryService.get).toHaveBeenCalledWith('wf-1');
    expect(archiveStore.archive).toHaveBeenCalledWith(details);
    expect(stateService.delete).toHaveBeenCalledWith('wf-1');
    expect(metrics.retentionArchived).toHaveBeenCalledWith(1);
  });

  it('continues processing remaining executions when one deletion fails', async () => {
    const { service, registry, stateService, metrics } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('wf', { retention: { ttlMs: 60_000 } }),
    ]);
    stateService.findCompleted.mockResolvedValue([
      createWorkflowExecutionState({ workflowId: 'wf-1' }),
      createWorkflowExecutionState({ workflowId: 'wf-2' }),
    ]);
    stateService.delete
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await expect(service.cleanup()).resolves.toBeUndefined();

    expect(stateService.delete).toHaveBeenCalledTimes(2);
    expect(metrics.retentionDeleted).toHaveBeenCalledWith(1);
  });

  it('passes ttlMs and batchSize through to findCompleted', async () => {
    const { service, registry, stateService } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('wf', {
        retention: { ttlMs: 60_000, batchSize: 25 },
      }),
    ]);

    await service.cleanup();

    expect(stateService.findCompleted).toHaveBeenCalledWith(
      'wf',
      1,
      60_000,
      25,
    );
  });
});
