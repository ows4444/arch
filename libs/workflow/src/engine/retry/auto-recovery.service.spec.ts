import { WorkflowAutoRecoveryService } from './auto-recovery.service';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function registeredWorkflow(
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    metadata: { name, version: 1, ...overrides },
  };
}

function setup() {
  const recovery = {
    findRecoverableExecutions: jest.fn().mockResolvedValue([]),
    findStuckExecutions: jest.fn().mockResolvedValue([]),
    findExpiredWaitingExecutions: jest.fn().mockResolvedValue([]),
    findSleepingReady: jest.fn().mockResolvedValue([]),
    findWaitingChildrenExecutions: jest.fn().mockResolvedValue([]),
    markAsRecoverable: jest.fn().mockResolvedValue(undefined),
  };
  const executor = {
    resume: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    wake: jest.fn().mockResolvedValue(undefined),
  };
  const registry = {
    getAll: jest.fn().mockReturnValue([registeredWorkflow('test-workflow')]),
  };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };
  const children = {
    checkJoinQuorum: jest.fn().mockResolvedValue(false),
  };
  const metrics = {
    sweepRecovered: jest.fn(),
    sweepStuckDetected: jest.fn(),
    sweepExpiredCancelled: jest.fn(),
    sweepSleepWoken: jest.fn(),
    sweepStuckJoinResumed: jest.fn(),
  };

  const service = new WorkflowAutoRecoveryService(
    recovery as never,
    executor as never,
    registry as never,
    scheduler as never,
    children as never,
    metrics as never,
  );

  return {
    service,
    recovery,
    executor,
    registry,
    scheduler,
    children,
    metrics,
  };
}

describe('WorkflowAutoRecoveryService.onModuleInit / onModuleDestroy', () => {
  it('schedules a sweep interval using the default when no workflow configures one', () => {
    const { service, scheduler } = setup();

    service.onModuleInit();

    expect(scheduler.addInterval).toHaveBeenCalledWith(
      'workflow-auto-recovery',
      expect.anything(),
    );
  });

  it('uses the smallest configured autoResume intervalMs across registered workflows', () => {
    const { service, registry, scheduler } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('a', { autoResume: { intervalMs: 10_000 } }),
      registeredWorkflow('b', { autoResume: { intervalMs: 5_000 } }),
    ]);

    jest.useFakeTimers();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');

    service.onModuleInit();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);

    setIntervalSpy.mockRestore();
    jest.useRealTimers();
    scheduler.deleteInterval('workflow-auto-recovery');
  });

  it('removes the interval on destroy without throwing if none was registered', () => {
    const { service, scheduler } = setup();

    expect(() => service.onModuleDestroy()).not.toThrow();
    expect(scheduler.deleteInterval).toHaveBeenCalledWith(
      'workflow-auto-recovery',
    );
  });
});

describe('WorkflowAutoRecoveryService.recover', () => {
  it('resumes each recoverable workflow and reports the count via metrics', async () => {
    const { service, recovery, executor, metrics } = setup();
    recovery.findRecoverableExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
      }),
    ]);

    await service.recover();

    expect(executor.resume).toHaveBeenCalledWith('wf-1');
    expect(metrics.sweepRecovered).toHaveBeenCalledWith(1);
  });

  it('skips a recoverable workflow whose retryAt is still in the future', async () => {
    const { service, recovery, executor } = setup();
    recovery.findRecoverableExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        retryAt: new Date(Date.now() + 60_000),
      }),
    ]);

    await service.recover();

    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('skips workflows whose definition has autoResume disabled', async () => {
    const { service, recovery, executor, registry } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('test-workflow', { autoResume: { enabled: false } }),
    ]);
    recovery.findRecoverableExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
      }),
    ]);

    await service.recover();

    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('skips workflows that have exhausted their configured maxAttempts', async () => {
    const { service, recovery, executor, registry } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('test-workflow', {
        autoResume: { maxAttempts: 2 },
      }),
    ]);
    recovery.findRecoverableExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
        recoveryAttempts: 2,
      }),
    ]);

    await service.recover();

    expect(executor.resume).not.toHaveBeenCalled();
  });

  it('continues the sweep when resuming one workflow throws', async () => {
    const { service, recovery, executor, metrics } = setup();
    recovery.findRecoverableExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
      }),
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        workflowName: 'test-workflow',
      }),
    ]);
    executor.resume
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.recover();

    expect(executor.resume).toHaveBeenCalledTimes(2);
    expect(metrics.sweepRecovered).toHaveBeenCalledWith(1);
  });

  it('marks stuck executions as recoverable and reports the count', async () => {
    const { service, recovery, metrics } = setup();
    recovery.findStuckExecutions.mockResolvedValue([
      createWorkflowExecutionState({ workflowId: 'wf-1' }),
    ]);

    await service.recover();

    expect(recovery.markAsRecoverable).toHaveBeenCalledWith('wf-1');
    expect(metrics.sweepStuckDetected).toHaveBeenCalledWith(1);
  });

  it('continues the sweep when marking one stuck workflow throws', async () => {
    const { service, recovery, metrics } = setup();
    recovery.findStuckExecutions.mockResolvedValue([
      createWorkflowExecutionState({ workflowId: 'wf-1' }),
      createWorkflowExecutionState({ workflowId: 'wf-2' }),
    ]);
    recovery.markAsRecoverable
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.recover();

    expect(recovery.markAsRecoverable).toHaveBeenCalledTimes(2);
    expect(metrics.sweepStuckDetected).toHaveBeenCalledWith(1);
  });

  it('cancels an expired-waiting execution once its signal timeout has elapsed', async () => {
    const { service, recovery, executor, registry, metrics } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('test-workflow', {
        signals: { defaultTimeoutMs: 60_000 },
      }),
    ]);
    recovery.findExpiredWaitingExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
        waitingSince: new Date(Date.now() - 120_000),
      }),
    ]);

    await service.recover();

    expect(executor.cancel).toHaveBeenCalledWith('wf-1', true);
    expect(metrics.sweepExpiredCancelled).toHaveBeenCalledWith(1);
  });

  it('does not cancel a waiting execution before its signal timeout elapses', async () => {
    const { service, recovery, executor, registry } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('test-workflow', {
        signals: { defaultTimeoutMs: 600_000 },
      }),
    ]);
    recovery.findExpiredWaitingExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
        waitingSince: new Date(Date.now() - 1_000),
      }),
    ]);

    await service.recover();

    expect(executor.cancel).not.toHaveBeenCalled();
  });

  it('continues the sweep when cancelling one expired-waiting workflow throws', async () => {
    const { service, recovery, executor, registry, metrics } = setup();
    registry.getAll.mockReturnValue([
      registeredWorkflow('test-workflow', {
        signals: { defaultTimeoutMs: 60_000 },
      }),
    ]);
    recovery.findExpiredWaitingExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
        waitingSince: new Date(Date.now() - 120_000),
      }),
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        workflowName: 'test-workflow',
        waitingSince: new Date(Date.now() - 120_000),
      }),
    ]);
    executor.cancel
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.recover();

    expect(executor.cancel).toHaveBeenCalledTimes(2);
    expect(metrics.sweepExpiredCancelled).toHaveBeenCalledWith(1);
  });

  it('wakes each ready sleeping workflow and reports the count via metrics', async () => {
    const { service, recovery, executor, metrics } = setup();
    recovery.findSleepingReady.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        workflowName: 'test-workflow',
        sleepUntil: new Date(Date.now() - 1000),
      }),
    ]);

    await service.recover();

    expect(executor.wake).toHaveBeenCalledWith('wf-1');
    expect(metrics.sweepSleepWoken).toHaveBeenCalledWith(1);
  });

  it('continues the sweep when waking one sleeping workflow throws', async () => {
    const { service, recovery, executor, metrics } = setup();
    recovery.findSleepingReady.mockResolvedValue([
      createWorkflowExecutionState({ workflowId: 'wf-1' }),
      createWorkflowExecutionState({ workflowId: 'wf-2' }),
    ]);
    executor.wake
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(undefined);

    await service.recover();

    expect(executor.wake).toHaveBeenCalledTimes(2);
    expect(metrics.sweepSleepWoken).toHaveBeenCalledWith(1);
  });

  it('re-checks join quorum for each waiting-children workflow and reports the count when it resumes', async () => {
    const { service, recovery, children, metrics } = setup();
    recovery.findWaitingChildrenExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        status: 'waiting-children',
        joinId: 'wf-1:fan-out:1',
      }),
    ]);
    children.checkJoinQuorum.mockResolvedValue(true);

    await service.recover();

    expect(children.checkJoinQuorum).toHaveBeenCalledWith('wf-1');
    expect(metrics.sweepStuckJoinResumed).toHaveBeenCalledWith(1);
  });

  it('does not count a re-check whose quorum is still unmet', async () => {
    const { service, recovery, children, metrics } = setup();
    recovery.findWaitingChildrenExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        status: 'waiting-children',
      }),
    ]);
    children.checkJoinQuorum.mockResolvedValue(false);

    await service.recover();

    expect(metrics.sweepStuckJoinResumed).toHaveBeenCalledWith(0);
  });

  it('continues the sweep when re-checking one join throws', async () => {
    const { service, recovery, children, metrics } = setup();
    recovery.findWaitingChildrenExecutions.mockResolvedValue([
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        status: 'waiting-children',
      }),
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        status: 'waiting-children',
      }),
    ]);
    children.checkJoinQuorum
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);

    await service.recover();

    expect(children.checkJoinQuorum).toHaveBeenCalledTimes(2);
    expect(metrics.sweepStuckJoinResumed).toHaveBeenCalledWith(1);
  });
});
