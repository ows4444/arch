import { WorkflowRunner } from './runner';
import {
  WorkflowConcurrencyError,
  WorkflowExecutionError,
} from '../../errors/workflow.errors';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../models/workflow-step-id';

function setup() {
  const stepExecutor = { execute: jest.fn() };
  const stateService = {
    save: jest.fn(),
    reload: jest.fn(),
    load: jest.fn(),
  };
  const stepPersistence = {
    startStep: jest.fn(),
    recordStepAttempt: jest.fn(),
    completeStep: jest.fn(),
  };
  const transitionValidator = { validate: jest.fn() };
  const logger = {
    deprecatedStep: jest.fn(),
    stepStarted: jest.fn(),
    stepCompleted: jest.fn(),
  };

  const runner = new WorkflowRunner(
    stepExecutor as never,
    stateService as never,
    stepPersistence as never,
    transitionValidator,
    logger as never,
  );

  const workflow = {
    metadata: { name: 'test-workflow' },
    steps: new Map([
      ['step-1', { metadata: {} }],
      ['step-2', { metadata: {} }],
    ]),
  };

  return {
    runner,
    workflow,
    stepExecutor,
    stateService,
    stepPersistence,
  };
}

describe('WorkflowRunner', () => {
  it('runs a single step to completion and stops when there is no next step', async () => {
    const { runner, workflow, stepExecutor, stateService, stepPersistence } =
      setup();

    const started = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      executingStep: createWorkflowStepId('step-1'),
      stateVersion: 2,
    });

    stateService.load.mockResolvedValue({ ...started, stateVersion: 2 });

    stepExecutor.execute.mockResolvedValue({
      result: { nextStep: undefined },
      latestState: { ...started, status: 'running' },
    });

    const completed = createWorkflowExecutionState({
      currentStep: undefined,
      status: 'completed',
    });
    stepPersistence.completeStep.mockResolvedValue(completed);

    const result = await runner.run(workflow as never, started);

    expect(result).toBe(completed);
    expect(stepPersistence.startStep).not.toHaveBeenCalled();
    expect(stepPersistence.recordStepAttempt).toHaveBeenCalledTimes(1);
  });

  it('reloads and retries when the initial startStep save hits a concurrency conflict', async () => {
    const { runner, workflow, stepExecutor, stateService, stepPersistence } =
      setup();

    const initial = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      stateVersion: 1,
    });

    const reloaded = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      stateVersion: 2,
    });

    stepPersistence.startStep
      .mockRejectedValueOnce(new WorkflowConcurrencyError('stale'))
      .mockResolvedValueOnce({
        ...reloaded,
        executingStep: createWorkflowStepId('step-1'),
      });
    stateService.reload.mockResolvedValue(reloaded);
    stateService.load.mockResolvedValue({ ...reloaded, stateVersion: 2 });

    stepExecutor.execute.mockResolvedValue({
      result: { nextStep: undefined },
      latestState: { ...reloaded, status: 'running' },
    });

    const completed = createWorkflowExecutionState({
      currentStep: undefined,
      status: 'completed',
    });
    stepPersistence.completeStep.mockResolvedValue(completed);

    const result = await runner.run(workflow as never, initial);

    expect(stateService.reload).toHaveBeenCalledWith(initial);
    expect(result).toBe(completed);
  });

  it('propagates non-concurrency errors from the startStep save', async () => {
    const { runner, workflow, stepPersistence } = setup();

    const initial = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
    });

    stepPersistence.startStep.mockRejectedValue(
      new WorkflowExecutionError('unexpected'),
    );

    await expect(runner.run(workflow as never, initial)).rejects.toThrow(
      WorkflowExecutionError,
    );
  });

  it('returns the latest state when the workflow was cancelled mid-step', async () => {
    const { runner, workflow, stepExecutor, stateService, stepPersistence } =
      setup();

    const started = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      executingStep: createWorkflowStepId('step-1'),
      stateVersion: 1,
    });

    stepPersistence.startStep.mockResolvedValue(started);

    const cancelled = createWorkflowExecutionState({
      status: 'cancelled',
      stateVersion: 2,
    });
    stateService.load.mockResolvedValue(cancelled);

    stepExecutor.execute.mockResolvedValue({
      result: { nextStep: undefined },
      latestState: started,
    });

    const result = await runner.run(workflow as never, started);

    expect(result).toBe(cancelled);
  });

  it('throws when the workflow state changed unexpectedly while a step was executing', async () => {
    const { runner, workflow, stepExecutor, stateService, stepPersistence } =
      setup();

    const started = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      executingStep: createWorkflowStepId('step-1'),
      stateVersion: 1,
    });

    stepPersistence.startStep.mockResolvedValue(started);
    stateService.load.mockResolvedValue({
      ...started,
      status: 'running',
      stateVersion: 99,
    });

    stepExecutor.execute.mockResolvedValue({
      result: { nextStep: undefined },
      latestState: started,
    });

    await expect(runner.run(workflow as never, started)).rejects.toThrow(
      /changed while step/,
    );
  });

  it('throws when max iterations are exceeded', async () => {
    const { runner, workflow } = setup();

    const runaway = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      iteration: 1_000_000,
    });

    await expect(runner.run(workflow as never, runaway)).rejects.toThrow(
      /exceeded max iterations/,
    );
  });

  it('stops and returns the waiting state when the step result requires a signal', async () => {
    const { runner, workflow, stepExecutor, stateService, stepPersistence } =
      setup();

    const started = createWorkflowExecutionState({
      currentStep: createWorkflowStepId('step-1'),
      executingStep: createWorkflowStepId('step-1'),
      stateVersion: 1,
    });

    stepPersistence.startStep.mockResolvedValue(started);
    stateService.load.mockResolvedValue({ ...started, stateVersion: 1 });

    stepExecutor.execute.mockResolvedValue({
      result: {
        waitForSignal: { name: 'approval', signalId: 'signal-1' },
      },
      latestState: started,
    });

    const waiting = createWorkflowExecutionState({ status: 'waiting' });
    stepPersistence.completeStep.mockResolvedValue(waiting);

    const result = await runner.run(workflow as never, started);

    expect(result).toBe(waiting);
  });
});
