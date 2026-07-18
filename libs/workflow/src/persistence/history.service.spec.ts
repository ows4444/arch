import { WorkflowHistoryService } from './history.service';
import { createWorkflowStepId } from '../models/workflow-step-id';

function execution() {
  return {
    step: createWorkflowStepId('step-1'),
    startedAt: new Date(),
    status: 'started' as const,
  };
}

describe('WorkflowHistoryService with a store configured', () => {
  function setup() {
    const store = {
      append: jest.fn().mockResolvedValue(undefined),
      findByWorkflowId: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const service = new WorkflowHistoryService(store);

    return { service, store };
  }

  it('delegates append to the store', async () => {
    const { service, store } = setup();
    const exec = execution();

    await service.append('wf-1', exec);

    expect(store.append).toHaveBeenCalledWith('wf-1', exec);
  });

  it('delegates findByWorkflowId to the store', async () => {
    const { service, store } = setup();
    const records = [execution()];
    store.findByWorkflowId.mockResolvedValue(records);

    await expect(service.findByWorkflowId('wf-1')).resolves.toBe(records);
  });

  it('delegates delete to the store', async () => {
    const { service, store } = setup();

    await service.delete('wf-1');

    expect(store.delete).toHaveBeenCalledWith('wf-1');
  });
});

describe('WorkflowHistoryService with no store configured (optional dependency)', () => {
  it('append is a no-op rather than throwing', async () => {
    const service = new WorkflowHistoryService(undefined);

    await expect(service.append('wf-1', execution())).resolves.toBeUndefined();
  });

  it('findByWorkflowId returns an empty array', async () => {
    const service = new WorkflowHistoryService(undefined);

    await expect(service.findByWorkflowId('wf-1')).resolves.toEqual([]);
  });

  it('delete is a no-op rather than throwing', async () => {
    const service = new WorkflowHistoryService(undefined);

    await expect(service.delete('wf-1')).resolves.toBeUndefined();
  });
});
