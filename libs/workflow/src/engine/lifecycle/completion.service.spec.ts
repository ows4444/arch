import { WorkflowCompletionService } from './completion.service';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../models/workflow-step-id';

function setup() {
  const transitions = {
    completeWorkflow: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        status: 'completed',
        currentStep: undefined,
      }),
    ),
  };
  const stateService = {
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
  };
  const children = {
    findChildren: jest.fn().mockResolvedValue([]),
    isManagedChild: jest.fn().mockReturnValue(false),
    findParent: jest.fn().mockResolvedValue(null),
    onChildCompleted: jest.fn(),
  };
  const registry = {
    get: jest.fn().mockReturnValue({
      metadata: { name: 'test-workflow', childWorkflows: [] },
    }),
  };
  const publisher = { completed: jest.fn() };

  const afterCommitCallbacks: Array<() => Promise<void>> = [];
  const transactionRunner = {
    executeOrJoin: jest.fn((operation: () => unknown) => operation()),
    isActive: jest.fn(() => true),
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

  const service = new WorkflowCompletionService(
    transitions as never,
    stateService as never,
    children as never,
    registry as never,
    publisher as never,
    transactionRunner as never,
  );

  return {
    service,
    transitions,
    stateService,
    children,
    registry,
    publisher,
    transactionRunner,
    flushAfterCommit,
  };
}

describe('WorkflowCompletionService', () => {
  it('does not complete a workflow that still has a current step', async () => {
    const { service, stateService } = setup();
    const state = createWorkflowExecutionState({
      status: 'running',
      currentStep: createWorkflowStepId('step-1'),
    });

    const result = await service.completeIfFinished(state);

    expect(result.completed).toBe(false);
    expect(result.state).toBe(state);
    expect(stateService.save).not.toHaveBeenCalled();
  });

  it('does not complete a workflow that is not running', async () => {
    const { service, stateService } = setup();
    const state = createWorkflowExecutionState({
      status: 'waiting',
      currentStep: undefined,
    });

    const result = await service.completeIfFinished(state);

    expect(result.completed).toBe(false);
    expect(stateService.save).not.toHaveBeenCalled();
  });

  it('defers completion while a managed child is still active', async () => {
    const { service, children, stateService } = setup();
    const state = createWorkflowExecutionState({
      status: 'running',
      currentStep: undefined,
    });

    children.findChildren.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'child-1',
        status: 'running',
      }),
    ]);
    children.isManagedChild.mockReturnValue(true);

    const result = await service.completeIfFinished(state);

    expect(result.completed).toBe(false);
    expect(stateService.save).not.toHaveBeenCalled();
  });

  it('ignores unmanaged children when deciding whether to complete', async () => {
    const { service, children } = setup();
    const state = createWorkflowExecutionState({
      status: 'running',
      currentStep: undefined,
    });

    children.findChildren.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'child-1',
        status: 'running',
      }),
    ]);
    children.isManagedChild.mockReturnValue(false);

    const result = await service.completeIfFinished(state);

    expect(result.completed).toBe(true);
  });

  it('completes the workflow once all managed children have finished', async () => {
    const { service, children, publisher, flushAfterCommit } = setup();
    const state = createWorkflowExecutionState({
      status: 'running',
      currentStep: undefined,
    });

    children.findChildren.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'child-1',
        status: 'completed',
      }),
    ]);
    children.isManagedChild.mockReturnValue(true);

    const result = await service.completeIfFinished(state);
    await flushAfterCommit();

    expect(result.completed).toBe(true);
    expect(result.state.status).toBe('completed');
    expect(publisher.completed).toHaveBeenCalledTimes(1);
  });

  it('notifies the parent when a managed child workflow completes', async () => {
    const { service, children, flushAfterCommit } = setup();
    const parent = createWorkflowExecutionState({ workflowId: 'parent-1' });
    const state = createWorkflowExecutionState({
      status: 'running',
      currentStep: undefined,
      parentWorkflowId: 'parent-1',
    });

    children.findParent.mockResolvedValue(parent);

    const result = await service.completeIfFinished(state);

    // Deferred to afterCommit — see completion.service.ts's comment on
    // this call — so onChildCompleted() shouldn't fire until the deferred
    // callback runs.
    expect(children.onChildCompleted).not.toHaveBeenCalled();

    await flushAfterCommit();

    expect(children.onChildCompleted).toHaveBeenCalledWith(
      parent,
      result.state,
    );
  });
});
