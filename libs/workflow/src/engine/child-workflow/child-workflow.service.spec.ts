import { ChildWorkflowService } from './child-workflow.service';
import { WorkflowConcurrencyError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

class ChildWorkflowClass {}
class ParentWorkflowClass {}

function setup(maxRetries = 3) {
  const executor = {
    resume: jest.fn(),
    execute: jest.fn(),
    cancel: jest.fn(),
    findByParentWorkflowId: jest.fn(),
  };
  const stateService = {
    save: jest.fn(),
    findByParentWorkflowId: jest.fn(),
    load: jest.fn(),
  };
  const compensation = { compensate: jest.fn().mockResolvedValue(true) };
  const transitions = {
    resetForRetry: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        status: 'running',
      }),
    ),
  };
  const parentFailureHandler = { failExecution: jest.fn() };
  const retryDelay = { compute: jest.fn().mockReturnValue(0) };
  const retryJitter = { apply: jest.fn().mockReturnValue(0) };
  const retryScheduler = { wait: jest.fn().mockResolvedValue(undefined) };

  const childDefinition = {
    workflow: ChildWorkflowClass,
    failurePolicy: 'retry-child' as const,
    cancellationPolicy: 'detach' as const,
    maxRetries,
  };

  const registeredChild = {
    metadata: { name: 'child-workflow', version: 1 },
    workflowType: ChildWorkflowClass,
    steps: new Map(),
    transitions: new Map(),
  };

  const registeredParent = {
    metadata: {
      name: 'parent-workflow',
      version: 1,
      childWorkflows: [childDefinition],
    },
    workflowType: ParentWorkflowClass,
    steps: new Map(),
    transitions: new Map(),
  };

  const registry = {
    get: jest.fn().mockReturnValue(registeredParent),
    getAll: jest.fn().mockReturnValue([registeredChild, registeredParent]),
  };

  const service = new ChildWorkflowService(
    executor as never,
    stateService as never,
    compensation as never,
    registry as never,
    transitions as never,
    retryDelay,
    parentFailureHandler,
    retryJitter,
    retryScheduler,
  );

  return {
    service,
    executor,
    stateService,
    transitions,
    parentFailureHandler,
    retryDelay,
    retryJitter,
    retryScheduler,
    compensation,
    registeredParent,
  };
}

describe('ChildWorkflowService', () => {
  const parent = createWorkflowExecutionState({
    workflowId: 'parent-1',
    workflowName: 'parent-workflow',
  });

  it('retries the child and resumes execution when under maxRetries', async () => {
    const { service, executor, stateService } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    stateService.save.mockResolvedValue(child);

    await service.onChildFailed(parent, child);

    expect(stateService.save).toHaveBeenCalledTimes(1);
    expect(executor.resume).toHaveBeenCalledWith('child-1');
  });

  it('waits for a computed backoff delay before resuming a failed child', async () => {
    const {
      service,
      executor,
      stateService,
      retryDelay,
      retryJitter,
      retryScheduler,
    } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 2,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    retryDelay.compute.mockReturnValue(4000);
    retryJitter.apply.mockReturnValue(1234);
    stateService.save.mockResolvedValue(child);

    await service.onChildFailed(parent, child);

    expect(retryDelay.compute).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: 'exponential' }),
      2,
    );
    expect(retryJitter.apply).toHaveBeenCalledWith(4000, 2);
    expect(retryScheduler.wait).toHaveBeenCalledWith(1234);

    const waitOrder = retryScheduler.wait.mock.invocationCallOrder[0]!;
    const resumeOrder = executor.resume.mock.invocationCallOrder[0]!;
    expect(waitOrder).toBeLessThan(resumeOrder);
  });

  it('treats a concurrent save conflict during retry as recoverable rather than an unexpected failure', async () => {
    const { service, stateService, executor } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    stateService.save.mockRejectedValue(
      new WorkflowConcurrencyError('stale state version'),
    );

    await expect(service.onChildFailed(parent, child)).resolves.toBeUndefined();
    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('does not retry once maxRetries has been reached', async () => {
    const { service, stateService, executor } = setup(3);
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 3,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    await service.onChildFailed(parent, child);

    expect(stateService.save).not.toHaveBeenCalled();
    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('skips retry when the last failure is marked non-retriable', async () => {
    const { service, stateService } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: false },
    });

    await service.onChildFailed(parent, child);

    expect(stateService.save).not.toHaveBeenCalled();
  });

  describe('compensate-parent policy', () => {
    it('compensates and fails the parent when a child fails', async () => {
      const { service, compensation, parentFailureHandler, registeredParent } =
        setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'compensate-parent';

      const child = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        status: 'failed',
      });

      await service.onChildFailed(parent, child);

      expect(compensation.compensate).toHaveBeenCalledWith(
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({ metadata: expect.any(Object) }),
        parent,
      );
      expect(parentFailureHandler.failExecution).toHaveBeenCalledTimes(1);
    });

    it('still fails the parent even when compensation does not fully complete', async () => {
      const { service, compensation, parentFailureHandler, registeredParent } =
        setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'compensate-parent';
      compensation.compensate.mockResolvedValue(false);

      const child = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        status: 'failed',
      });

      await expect(
        service.onChildFailed(parent, child),
      ).resolves.toBeUndefined();

      expect(parentFailureHandler.failExecution).toHaveBeenCalledTimes(1);
    });

    it('does not compensate when the parent is already terminal', async () => {
      const { service, compensation, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'compensate-parent';

      const terminalParent = createWorkflowExecutionState({
        workflowId: 'parent-1',
        workflowName: 'parent-workflow',
        status: 'completed',
      });
      const child = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        status: 'failed',
      });

      await service.onChildFailed(terminalParent, child);

      expect(compensation.compensate).not.toHaveBeenCalled();
    });
  });

  describe('startChildren', () => {
    it('starts each declared child using its registered business name, not its class identifier', async () => {
      const { service, executor } = setup();
      executor.execute.mockResolvedValue({
        workflowId: 'child-1',
        status: 'running',
        iteration: 0,
        data: {},
      });

      const workflow = {
        metadata: {
          name: 'parent-workflow',
          version: 1,
          childWorkflows: [
            {
              workflow: ChildWorkflowClass,
              failurePolicy: 'ignore' as const,
              cancellationPolicy: 'detach' as const,
            },
          ],
        },
      };

      await service.startChildren(workflow as never, parent);

      expect(executor.execute).toHaveBeenCalledWith(
        'child-workflow',
        {},
        expect.objectContaining({ parentWorkflowId: 'parent-1' }),
      );
    });
  });

  describe('cancelChildren', () => {
    function propagatingWorkflow() {
      return {
        metadata: {
          name: 'parent-workflow',
          version: 1,
          childWorkflows: [
            {
              workflow: ChildWorkflowClass,
              failurePolicy: 'ignore' as const,
              cancellationPolicy: 'propagate' as const,
            },
          ],
        },
      };
    }

    it('cancels all propagating children in parallel', async () => {
      const { service, executor } = setup();
      executor.findByParentWorkflowId.mockResolvedValue([
        createWorkflowExecutionState({
          workflowId: 'child-1',
          workflowName: 'child-workflow',
          status: 'running',
        }),
        createWorkflowExecutionState({
          workflowId: 'child-2',
          workflowName: 'child-workflow',
          status: 'waiting',
        }),
      ]);
      executor.cancel.mockResolvedValue(undefined);

      await service.cancelChildren(propagatingWorkflow() as never, parent);

      expect(executor.cancel).toHaveBeenCalledWith('child-1');
      expect(executor.cancel).toHaveBeenCalledWith('child-2');
      expect(executor.cancel).toHaveBeenCalledTimes(2);
    });

    it('skips children already in a terminal status', async () => {
      const { service, executor } = setup();
      executor.findByParentWorkflowId.mockResolvedValue([
        createWorkflowExecutionState({
          workflowId: 'child-1',
          workflowName: 'child-workflow',
          status: 'completed',
        }),
      ]);

      await service.cancelChildren(propagatingWorkflow() as never, parent);

      expect(executor.cancel).not.toHaveBeenCalled();
    });

    it('continues cancelling remaining children when one cancellation rejects', async () => {
      const { service, executor } = setup();
      executor.findByParentWorkflowId.mockResolvedValue([
        createWorkflowExecutionState({
          workflowId: 'child-1',
          workflowName: 'child-workflow',
          status: 'running',
        }),
        createWorkflowExecutionState({
          workflowId: 'child-2',
          workflowName: 'child-workflow',
          status: 'running',
        }),
      ]);
      executor.cancel.mockImplementation((id: string) =>
        id === 'child-1'
          ? Promise.reject(new Error('boom'))
          : Promise.resolve(undefined),
      );

      await expect(
        service.cancelChildren(propagatingWorkflow() as never, parent),
      ).resolves.toBeUndefined();

      expect(executor.cancel).toHaveBeenCalledWith('child-1');
      expect(executor.cancel).toHaveBeenCalledWith('child-2');
    });
  });
});
