import { WorkflowQueryDispatchService } from './query-dispatch.service';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

class SummaryQueryHandler {
  handle = jest.fn().mockResolvedValue({ summary: 'ok' });
}

function setup() {
  const moduleRef = { get: jest.fn() };
  const registry = { get: jest.fn() };
  const stateService = { load: jest.fn() };

  const service = new WorkflowQueryDispatchService(
    moduleRef as never,
    registry as never,
    stateService as never,
  );

  return { service, moduleRef, registry, stateService };
}

describe('WorkflowQueryDispatchService', () => {
  it('throws when the workflow does not exist', async () => {
    const { service, stateService } = setup();
    stateService.load.mockResolvedValue(null);

    await expect(service.query('missing', 'summary')).rejects.toThrow(
      WorkflowExecutionError,
    );
  });

  it('throws when the workflow has no query handler with that name', async () => {
    const { service, stateService, registry } = setup();
    const state = createWorkflowExecutionState();
    stateService.load.mockResolvedValue(state);
    registry.get.mockReturnValue({
      metadata: { name: 'test-workflow' },
      queries: new Map(),
    });

    await expect(service.query(state.workflowId, 'summary')).rejects.toThrow(
      /has no query handler named 'summary'/,
    );
  });

  it('throws when the handler type has no resolvable instance', async () => {
    const { service, stateService, registry, moduleRef } = setup();
    const state = createWorkflowExecutionState();
    stateService.load.mockResolvedValue(state);
    registry.get.mockReturnValue({
      metadata: { name: 'test-workflow' },
      queries: new Map([['summary', SummaryQueryHandler]]),
    });
    moduleRef.get.mockReturnValue(undefined);

    await expect(service.query(state.workflowId, 'summary')).rejects.toThrow(
      /Query handler instance not found/,
    );
  });

  it('resolves the handler instance and invokes it with state and args', async () => {
    const { service, stateService, registry, moduleRef } = setup();
    const state = createWorkflowExecutionState({ data: { count: 3 } });
    const handler = new SummaryQueryHandler();
    stateService.load.mockResolvedValue(state);
    registry.get.mockReturnValue({
      metadata: { name: 'test-workflow' },
      queries: new Map([['summary', SummaryQueryHandler]]),
    });
    moduleRef.get.mockReturnValue(handler);

    const result = await service.query(state.workflowId, 'summary', {
      verbose: true,
    });

    expect(handler.handle).toHaveBeenCalledWith(state, { verbose: true });
    expect(result).toEqual({ summary: 'ok' });
  });
});
