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
    resumeJoin: jest.fn().mockResolvedValue(undefined),
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

  const afterCommitCallbacks: Array<() => Promise<void>> = [];
  const transactionRunner = {
    afterCommit: jest.fn((callback: () => Promise<void>) => {
      afterCommitCallbacks.push(callback);
    }),
  };
  const flushAfterCommit = async (): Promise<void> => {
    const callbacks = afterCommitCallbacks.splice(
      0,
      afterCommitCallbacks.length,
    );

    for (const callback of callbacks) {
      await callback();
    }
  };

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
    transactionRunner as never,
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
    transactionRunner,
    flushAfterCommit,
  };
}

function waitingParent(overrides: Partial<WorkflowExecutionState> = {}) {
  return createWorkflowExecutionState({
    workflowId: 'parent-1',
    workflowName: 'parent-workflow',
    status: 'waiting-children',
    joinId: 'parent-1:fan-out:1',
    joinPolicy: 'all',
    ...overrides,
  });
}

function fanOutChild(overrides: Partial<WorkflowExecutionState> = {}) {
  return createWorkflowExecutionState({
    workflowId: 'child-1',
    workflowName: 'child-workflow',
    joinId: 'parent-1:fan-out:1',
    status: 'completed',
    ...overrides,
  });
}

describe('ChildWorkflowService', () => {
  const parent = createWorkflowExecutionState({
    workflowId: 'parent-1',
    workflowName: 'parent-workflow',
  });

  it('defers the retry-child policy to run after the failing transaction commits', async () => {
    // WorkflowFailureService.failExecution calls onChildFailed synchronously,
    // nested inside the failing child's own still-open transaction. A
    // 'retry-child' policy must not run inline there — it can block for a
    // real-time backoff delay, which would hold that transaction (and its
    // connection/locks) open for the wait's duration. See child-workflow
    // .service.ts's afterCommit comment on this case.
    const { service, executor, stateService, transactionRunner } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    stateService.save.mockResolvedValue(child);

    await service.onChildFailed(parent, child);

    expect(transactionRunner.afterCommit).toHaveBeenCalledTimes(1);
    expect(stateService.save).not.toHaveBeenCalled();
    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('retries the child and resumes execution when under maxRetries', async () => {
    const { service, executor, stateService, flushAfterCommit } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    stateService.save.mockResolvedValue(child);

    await service.onChildFailed(parent, child);
    await flushAfterCommit();

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
      flushAfterCommit,
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
    await flushAfterCommit();

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
    const { service, stateService, executor, flushAfterCommit } = setup();
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

    await service.onChildFailed(parent, child);

    await expect(flushAfterCommit()).resolves.toBeUndefined();
    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('does not retry once maxRetries has been reached', async () => {
    const { service, stateService, executor, flushAfterCommit } = setup(3);
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 3,
      lastFailure: { code: 'ERR', message: 'boom', retriable: true },
    });

    await service.onChildFailed(parent, child);
    await flushAfterCommit();

    expect(stateService.save).not.toHaveBeenCalled();
    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('skips retry when the last failure is marked non-retriable', async () => {
    const { service, stateService, flushAfterCommit } = setup();
    const child = createWorkflowExecutionState({
      workflowId: 'child-1',
      workflowName: 'child-workflow',
      status: 'failed',
      failureCount: 1,
      lastFailure: { code: 'ERR', message: 'boom', retriable: false },
    });

    await service.onChildFailed(parent, child);
    await flushAfterCommit();

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

    it('does not auto-start a child declared with trigger: step', async () => {
      const { service, executor } = setup();

      const workflow = {
        metadata: {
          name: 'parent-workflow',
          version: 1,
          childWorkflows: [
            {
              workflow: ChildWorkflowClass,
              failurePolicy: 'ignore' as const,
              cancellationPolicy: 'detach' as const,
              trigger: 'step' as const,
            },
          ],
        },
      };

      await service.startChildren(workflow as never, parent);

      expect(executor.execute).not.toHaveBeenCalled();
    });
  });

  describe('spawnFanOut', () => {
    function fanOutWorkflow() {
      return {
        metadata: {
          name: 'parent-workflow',
          version: 1,
          childWorkflows: [
            {
              workflow: ChildWorkflowClass,
              failurePolicy: 'ignore' as const,
              cancellationPolicy: 'detach' as const,
              trigger: 'step' as const,
            },
          ],
        },
      };
    }

    it('spawns one child per spec, tagging each with the parent joinId', async () => {
      const { service, executor } = setup();
      executor.execute.mockResolvedValue({
        workflowId: 'child-1',
        status: 'running',
        iteration: 0,
        data: {},
      });
      const parentWaiting = createWorkflowExecutionState({
        workflowId: 'parent-1',
        workflowName: 'parent-workflow',
        status: 'waiting-children',
        joinId: 'parent-1:fan-out:1',
      });

      await service.spawnFanOut(fanOutWorkflow() as never, parentWaiting, [
        { workflow: ChildWorkflowClass, input: { branch: 1 } },
        { workflow: ChildWorkflowClass, input: { branch: 2 } },
      ]);

      expect(executor.execute).toHaveBeenCalledTimes(2);
      expect(executor.execute).toHaveBeenCalledWith(
        'child-workflow',
        { branch: 1 },
        expect.objectContaining({
          parentWorkflowId: 'parent-1',
          joinId: 'parent-1:fan-out:1',
        }),
      );
    });

    it('does nothing when specs is empty', async () => {
      const { service, executor } = setup();

      await service.spawnFanOut(fanOutWorkflow() as never, parent, []);

      expect(executor.execute).not.toHaveBeenCalled();
    });

    it('fails the parent and cancels siblings when a spec references a workflow class not declared with trigger: step', async () => {
      const { service, executor, parentFailureHandler } = setup();
      executor.execute.mockResolvedValue({
        workflowId: 'child-1',
        status: 'running',
        iteration: 0,
        data: {},
      });

      const notDeclared = class Undeclared {};

      await service.spawnFanOut(fanOutWorkflow() as never, parent, [
        { workflow: notDeclared },
      ]);

      expect(parentFailureHandler.failExecution).toHaveBeenCalledTimes(1);
    });

    it('cancels already-started siblings when one spawn fails', async () => {
      const { service, executor, parentFailureHandler } = setup();
      executor.execute
        .mockResolvedValueOnce({
          workflowId: 'child-1',
          status: 'running',
          iteration: 0,
          data: {},
        })
        .mockRejectedValueOnce(new Error('boom'));

      await service.spawnFanOut(fanOutWorkflow() as never, parent, [
        { workflow: ChildWorkflowClass },
        { workflow: ChildWorkflowClass },
      ]);

      expect(executor.cancel).toHaveBeenCalledWith('child-1');
      expect(parentFailureHandler.failExecution).toHaveBeenCalledTimes(1);
    });
  });

  describe('onChildCompleted / join quorum', () => {
    it('does nothing when the parent is not waiting-children', async () => {
      const { service, stateService, executor } = setup();
      const runningParent = createWorkflowExecutionState({
        workflowId: 'parent-1',
        workflowName: 'parent-workflow',
        status: 'running',
      });
      stateService.load.mockResolvedValue(runningParent);

      await service.onChildCompleted(runningParent, fanOutChild());

      expect(stateService.findByParentWorkflowId).not.toHaveBeenCalled();
      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("does nothing when the completed child's joinId does not match the parent's", async () => {
      const { service, executor } = setup();

      await service.onChildCompleted(
        waitingParent(),
        fanOutChild({ joinId: 'a-different-join' }),
      );

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("resumes the parent once 'all' siblings have completed", async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'completed' }),
      ]);

      await service.onChildCompleted(waitingParent(), fanOutChild());

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("does not resume the parent while an 'all' sibling is still running", async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'running' }),
      ]);

      await service.onChildCompleted(waitingParent(), fanOutChild());

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("resumes an 'all' join once the last sibling permanently fails via 'ignore' (fixes the deadlock)", async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'failed' }),
      ]);

      await service.onChildCompleted(waitingParent(), fanOutChild());

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("resumes an 'all' join once every sibling has exhausted its 'retry-child' retries", async () => {
      const { service, stateService, executor } = setup(2);
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({
          workflowId: 'child-2',
          status: 'failed',
          failureCount: 2,
        }),
      ]);

      await service.onChildCompleted(waitingParent(), fanOutChild());

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("does not resume an 'all' join while a 'retry-child' sibling still has retries left", async () => {
      const { service, stateService, executor } = setup(3);
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({
          workflowId: 'child-2',
          status: 'failed',
          failureCount: 1,
        }),
      ]);

      await service.onChildCompleted(waitingParent(), fanOutChild());

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("resumes the parent as soon as one sibling completes under 'any' policy", async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(waitingParent({ joinPolicy: 'any' }));
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'running' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: 'any' }),
        fanOutChild(),
      );

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("does not let a permanently-failed sibling satisfy 'any' — only successes count", async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(waitingParent({ joinPolicy: 'any' }));
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'failed' }),
        fanOutChild({ workflowId: 'child-2', status: 'running' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: 'any' }),
        fanOutChild({ workflowId: 'child-1', status: 'failed' }),
      );

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it('resumes the parent once the configured minimum count completes', async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(
        waitingParent({ joinPolicy: { min: 2 } }),
      );
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'completed' }),
        fanOutChild({ workflowId: 'child-3', status: 'running' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: { min: 2 } }),
        fanOutChild(),
      );

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it('does not resume the parent below the configured minimum count', async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(
        waitingParent({ joinPolicy: { min: 2 } }),
      );
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'running' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: { min: 2 } }),
        fanOutChild(),
      );

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it('resumes once the configured minimum becomes mathematically unreachable', async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(
        waitingParent({ joinPolicy: { min: 2 } }),
      );
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'failed' }),
        fanOutChild({ workflowId: 'child-3', status: 'failed' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: { min: 2 } }),
        fanOutChild({ workflowId: 'child-2', status: 'failed' }),
      );

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it('does not resume while the configured minimum is still reachable', async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(
        waitingParent({ joinPolicy: { min: 2 } }),
      );
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'running' }),
        fanOutChild({ workflowId: 'child-3', status: 'failed' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: { min: 2 } }),
        fanOutChild({ workflowId: 'child-3', status: 'failed' }),
      );

      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("resumes 'any' once its only sibling permanently fails", async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(waitingParent({ joinPolicy: 'any' }));
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'failed' }),
      ]);

      await service.onChildCompleted(
        waitingParent({ joinPolicy: 'any' }),
        fanOutChild({ workflowId: 'child-1', status: 'failed' }),
      );

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("does not treat zero-siblings-found as unreachable under 'any'/{ min } (regression: a stuck-join sweep re-check landing before spawnFanOut's children exist must not resume with an empty result)", async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(
        waitingParent({ joinPolicy: { min: 2 } }),
      );
      stateService.findByParentWorkflowId.mockResolvedValue([]);

      const resumed = await service.checkJoinQuorum('parent-1');

      expect(resumed).toBe(false);
      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it('logs rather than throws when resumeJoin fails', async () => {
      const { service, stateService, executor } = setup();
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
      ]);
      executor.resumeJoin.mockRejectedValue(new Error('lease held elsewhere'));

      await expect(
        service.onChildCompleted(waitingParent(), fanOutChild()),
      ).resolves.toBeUndefined();
    });
  });

  describe('summarizeJoin', () => {
    it('throws when the parent workflow does not exist', async () => {
      const { service, stateService } = setup();
      stateService.load.mockResolvedValue(null);

      await expect(service.summarizeJoin('missing', 'join-1')).rejects.toThrow(
        /not found/,
      );
    });

    it('categorizes siblings into succeeded/failed/pending', async () => {
      const { service, stateService, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        fanOutChild({ workflowId: 'child-1', status: 'completed' }),
        fanOutChild({ workflowId: 'child-2', status: 'failed' }),
        fanOutChild({ workflowId: 'child-3', status: 'running' }),
        fanOutChild({ workflowId: 'child-4', joinId: 'a-different-join' }),
      ]);

      const summary = await service.summarizeJoin(
        'parent-1',
        'parent-1:fan-out:1',
      );

      expect(summary.succeeded.map((s) => s.workflowId)).toEqual(['child-1']);
      expect(summary.failed.map((s) => s.workflowId)).toEqual(['child-2']);
      expect(summary.pending.map((s) => s.workflowId)).toEqual(['child-3']);
    });

    it('treats an unmanaged, non-completed sibling as pending rather than throwing', async () => {
      const { service, stateService } = setup();
      stateService.load.mockResolvedValue(waitingParent());
      stateService.findByParentWorkflowId.mockResolvedValue([
        createWorkflowExecutionState({
          workflowId: 'child-1',
          workflowName: 'unmanaged-workflow',
          joinId: 'parent-1:fan-out:1',
          status: 'failed',
        }),
      ]);

      const summary = await service.summarizeJoin(
        'parent-1',
        'parent-1:fan-out:1',
      );

      expect(summary.pending.map((s) => s.workflowId)).toEqual(['child-1']);
    });
  });

  describe('onChildFailed / join quorum', () => {
    const joinWaitingParent = createWorkflowExecutionState({
      workflowId: 'parent-1',
      workflowName: 'parent-workflow',
      status: 'waiting-children',
      joinId: 'parent-1:fan-out:1',
      joinPolicy: 'all',
    });

    it("checks join quorum after an 'ignore'-policy child permanently fails", async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      const failedChild = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        joinId: 'parent-1:fan-out:1',
        status: 'failed',
      });
      stateService.load.mockResolvedValue(joinWaitingParent);
      stateService.findByParentWorkflowId.mockResolvedValue([failedChild]);

      await service.onChildFailed(joinWaitingParent, failedChild);

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it('does not check join quorum for a failed child with no joinId (not part of a fan-out)', async () => {
      const { service, stateService, executor, registeredParent } = setup();
      (
        registeredParent.metadata.childWorkflows[0]! as {
          failurePolicy: string;
        }
      ).failurePolicy = 'ignore';
      const failedChild = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        status: 'failed',
      });

      await service.onChildFailed(joinWaitingParent, failedChild);

      expect(stateService.load).not.toHaveBeenCalled();
      expect(executor.resumeJoin).not.toHaveBeenCalled();
    });

    it("checks join quorum once a 'retry-child' sibling exhausts its retries", async () => {
      const { service, stateService, executor, flushAfterCommit } = setup(1);
      const exhaustedChild = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        joinId: 'parent-1:fan-out:1',
        status: 'failed',
        failureCount: 1,
        lastFailure: { code: 'ERR', message: 'boom', retriable: true },
      });
      stateService.load.mockResolvedValue(joinWaitingParent);
      stateService.findByParentWorkflowId.mockResolvedValue([exhaustedChild]);

      await service.onChildFailed(joinWaitingParent, exhaustedChild);
      await flushAfterCommit();

      expect(executor.resumeJoin).toHaveBeenCalledWith('parent-1');
    });

    it("does not check join quorum while a 'retry-child' sibling is still being retried", async () => {
      const { service, stateService, executor, flushAfterCommit } = setup(3);
      const retryingChild = createWorkflowExecutionState({
        workflowId: 'child-1',
        workflowName: 'child-workflow',
        joinId: 'parent-1:fan-out:1',
        status: 'failed',
        failureCount: 1,
        lastFailure: { code: 'ERR', message: 'boom', retriable: true },
      });
      stateService.save.mockResolvedValue(retryingChild);
      stateService.load.mockResolvedValue(joinWaitingParent);
      stateService.findByParentWorkflowId.mockResolvedValue([retryingChild]);

      await service.onChildFailed(joinWaitingParent, retryingChild);
      await flushAfterCommit();

      expect(executor.resumeJoin).not.toHaveBeenCalled();
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
