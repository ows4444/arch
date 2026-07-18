import { WorkflowStepExecutor } from './step-executor';
import { RetriableWorkflowError } from '../../errors';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../models/workflow-step-id';

class TestStepHandler {
  execute = jest.fn();
}

function setup() {
  const handler = new TestStepHandler();
  const resolver = { resolve: jest.fn().mockReturnValue(handler) };
  const retryDelay = { compute: jest.fn().mockReturnValue(0) };
  const validator = { validate: jest.fn() };
  const retryJitter = { apply: jest.fn().mockReturnValue(0) };
  const retryScheduler = { wait: jest.fn().mockResolvedValue(undefined) };
  const stateService = {
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
    isCancelled: jest.fn().mockResolvedValue(false),
  };
  const leaseService = {
    renew: jest.fn().mockResolvedValue(undefined),
    keepAlive: jest.fn().mockReturnValue(jest.fn()),
  };
  const persistence = {
    recordRetryAttempt: jest.fn(
      (previous: WorkflowExecutionState): Promise<WorkflowExecutionState> =>
        Promise.resolve({
          ...previous,
          stepRetryCount: (previous.stepRetryCount ?? 0) + 1,
        }),
    ),
  };
  const children = {
    summarizeJoin: jest
      .fn()
      .mockResolvedValue({ succeeded: [], failed: [], pending: [] }),
  };

  const executor = new WorkflowStepExecutor(
    resolver as never,
    retryDelay,
    validator,
    retryJitter,
    retryScheduler,
    stateService as never,
    leaseService as never,
    persistence as never,
    children as never,
  );

  const workflow = {
    metadata: { name: 'test-workflow' },
    steps: new Map([
      ['step-1', { metadata: {}, type: TestStepHandler as never }],
    ]),
  };

  return {
    executor,
    workflow,
    handler,
    resolver,
    retryDelay,
    validator,
    retryJitter,
    retryScheduler,
    stateService,
    leaseService,
    persistence,
    children,
  };
}

const state = () =>
  createWorkflowExecutionState({
    currentStep: createWorkflowStepId('step-1'),
    executingStep: createWorkflowStepId('step-1'),
  });

describe('WorkflowStepExecutor', () => {
  it('throws when the current step is not registered on the workflow', async () => {
    const { executor, workflow } = setup();
    const unknownStepState = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('missing-step'),
    });

    await expect(
      executor.execute(workflow as never, unknownStepState),
    ).rejects.toThrow(WorkflowExecutionError);
  });

  it('renews the lease and stops the keep-alive after execution', async () => {
    const { executor, workflow, handler, leaseService } = setup();
    const stopKeepAlive = jest.fn();
    leaseService.keepAlive.mockReturnValue(stopKeepAlive);
    handler.execute.mockResolvedValue({ nextStep: undefined });

    await executor.execute(workflow as never, state());

    expect(leaseService.renew).toHaveBeenCalledWith('workflow-1');
    expect(stopKeepAlive).toHaveBeenCalledTimes(1);
  });

  it('does not expose runtime.joinResults when the step is not resuming from a join', async () => {
    const { executor, workflow, handler } = setup();
    handler.execute.mockResolvedValue({ nextStep: undefined });

    await executor.execute(workflow as never, state());

    const [context] = handler.execute.mock.calls[0] as [
      { runtime: { joinResults?: unknown } },
    ];
    expect(context.runtime.joinResults).toBeUndefined();
  });

  it('exposes runtime.joinResults backed by ChildWorkflowService.summarizeJoin when resuming from a join', async () => {
    const { executor, workflow, handler, children } = setup();
    handler.execute.mockResolvedValue({ nextStep: undefined });
    const joinState = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      executingStep: createWorkflowStepId('step-1'),
      joinId: 'workflow-1:fan-out:1',
    });
    const summary = { succeeded: [], failed: [], pending: [] };
    children.summarizeJoin.mockResolvedValue(summary);

    await executor.execute(workflow as never, joinState);

    const [context] = handler.execute.mock.calls[0] as [
      { runtime: { joinResults: () => Promise<unknown> } },
    ];
    await expect(context.runtime.joinResults()).resolves.toBe(summary);
    expect(children.summarizeJoin).toHaveBeenCalledWith(
      'workflow-1',
      'workflow-1:fan-out:1',
    );
  });

  it('returns the handler result directly when the workflow has no retry policy', async () => {
    const { executor, workflow, handler } = setup();
    handler.execute.mockResolvedValue({ nextStep: undefined });

    const execution = await executor.execute(workflow as never, state());

    expect(execution.result).toEqual({ nextStep: undefined });
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-retriable error without retrying', async () => {
    const { executor, workflow, handler } = setup();
    workflow.metadata = {
      name: 'test-workflow',
      retries: { maxAttempts: 3, strategy: 'fixed' },
    } as never;
    handler.execute.mockRejectedValue(new Error('boom'));

    await expect(executor.execute(workflow as never, state())).rejects.toThrow(
      'boom',
    );
    expect(handler.execute).toHaveBeenCalledTimes(1);
  });

  it('retries a retriable failure up to maxAttempts, then rethrows', async () => {
    const { executor, workflow, handler, persistence, retryScheduler } =
      setup();
    workflow.metadata = {
      name: 'test-workflow',
      retries: { maxAttempts: 3, strategy: 'fixed', delayMs: 0 },
    } as never;
    handler.execute.mockRejectedValue(new RetriableWorkflowError('flaky'));

    await expect(executor.execute(workflow as never, state())).rejects.toThrow(
      RetriableWorkflowError,
    );

    expect(handler.execute).toHaveBeenCalledTimes(3);
    expect(persistence.recordRetryAttempt).toHaveBeenCalledTimes(2);
    expect(retryScheduler.wait).toHaveBeenCalledTimes(2);
  });

  it('succeeds after a transient retriable failure', async () => {
    const { executor, workflow, handler, persistence } = setup();
    workflow.metadata = {
      name: 'test-workflow',
      retries: { maxAttempts: 3, strategy: 'fixed', delayMs: 0 },
    } as never;
    handler.execute
      .mockRejectedValueOnce(new RetriableWorkflowError('flaky'))
      .mockResolvedValueOnce({ nextStep: undefined });

    const execution = await executor.execute(workflow as never, state());

    expect(execution.result).toEqual({ nextStep: undefined });
    expect(persistence.recordRetryAttempt).toHaveBeenCalledTimes(1);
  });

  it('gives each retry attempt its own timeout window instead of one shared across the whole retry budget', async () => {
    jest.useFakeTimers();

    const { executor, workflow, handler } = setup();
    workflow.metadata = {
      name: 'test-workflow',
      retries: { maxAttempts: 2, strategy: 'fixed', delayMs: 0 },
      defaultStepTimeoutMs: 1000,
    } as never;

    handler.execute
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new RetriableWorkflowError('flaky')), 600),
          ),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve({ nextStep: undefined }), 600),
          ),
      );

    const execution = executor.execute(workflow as never, state());

    await jest.advanceTimersByTimeAsync(1200);

    await expect(execution).resolves.toEqual(
      expect.objectContaining({ result: { nextStep: undefined } }),
    );
    expect(handler.execute).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });
});
