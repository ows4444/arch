import { WorkflowHookExecutor } from './hook-executor';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

class TestHook {
  async execute(): Promise<void> {
    // no-op
  }
}

function setup() {
  const moduleRef = { get: jest.fn() };
  const metrics = { hookFailed: jest.fn() };
  const registry = {
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
  };

  const executor = new WorkflowHookExecutor(
    moduleRef as never,
    metrics as never,
    registry as never,
  );

  return { executor, moduleRef, metrics, registry };
}

describe('WorkflowHookExecutor.execute', () => {
  const state = createWorkflowExecutionState();

  it('does nothing when no hook is provided', async () => {
    const { executor, moduleRef } = setup();

    await executor.execute(state, undefined);

    expect(moduleRef.get).not.toHaveBeenCalled();
  });

  it('skips execution when the workflow disables audit observability', async () => {
    const { executor, moduleRef, registry } = setup();
    registry.get.mockReturnValue({
      metadata: { name: 'test-workflow', observability: { audit: false } },
    });

    await executor.execute(state, TestHook);

    expect(moduleRef.get).not.toHaveBeenCalled();
  });

  it('logs a warning and does not throw when the hook instance cannot be resolved', async () => {
    const { executor, moduleRef } = setup();
    moduleRef.get.mockReturnValue(undefined);

    await expect(executor.execute(state, TestHook)).resolves.toBeUndefined();
  });

  it('invokes the resolved hook instance', async () => {
    const { executor, moduleRef } = setup();
    const instance = { execute: jest.fn().mockResolvedValue(undefined) };
    moduleRef.get.mockReturnValue(instance);

    await executor.execute(state, TestHook);

    expect(instance.execute).toHaveBeenCalledWith(state);
  });

  it('reports a metric and does not throw when the hook handler itself throws', async () => {
    const { executor, moduleRef, metrics } = setup();
    const instance = {
      execute: jest.fn().mockRejectedValue(new Error('boom')),
    };
    moduleRef.get.mockReturnValue(instance);

    await expect(executor.execute(state, TestHook)).resolves.toBeUndefined();
    expect(metrics.hookFailed).toHaveBeenCalledWith(
      'test-workflow',
      'TestHook',
    );
  });
});
