import { WorkflowRetryService } from './retry.service';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const transitions = {
    scheduleRetry: jest.fn(
      (
        state: WorkflowExecutionState,
        retryAt: Date,
      ): WorkflowExecutionState => ({
        ...state,
        status: 'running',
        retryAt,
        requiresRecovery: true,
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
  const retryDelay = { compute: jest.fn().mockReturnValue(1000) };
  const logger = { retryScheduled: jest.fn() };

  const service = new WorkflowRetryService(
    transitions as never,
    stateService as never,
    retryDelay,
    logger as never,
  );

  return { service, transitions, stateService, retryDelay, logger };
}

describe('WorkflowRetryService', () => {
  describe('canRetry', () => {
    it('returns false when the workflow is not in failed status', () => {
      const { service } = setup();
      const state = createWorkflowExecutionState({
        status: 'running',
        lastFailure: { code: 'E', message: 'm', retriable: true },
      });

      expect(service.canRetry(state, 3)).toBe(false);
    });

    it('returns false when the last failure is not retriable', () => {
      const { service } = setup();
      const state = createWorkflowExecutionState({
        status: 'failed',
        lastFailure: { code: 'E', message: 'm', retriable: false },
      });

      expect(service.canRetry(state, 3)).toBe(false);
    });

    it('returns false once failureCount reaches maxAttempts', () => {
      const { service } = setup();
      const state = createWorkflowExecutionState({
        status: 'failed',
        failureCount: 3,
        lastFailure: { code: 'E', message: 'm', retriable: true },
      });

      expect(service.canRetry(state, 3)).toBe(false);
    });

    it('returns true when failed, retriable, and under maxAttempts', () => {
      const { service } = setup();
      const state = createWorkflowExecutionState({
        status: 'failed',
        failureCount: 1,
        lastFailure: { code: 'E', message: 'm', retriable: true },
      });

      expect(service.canRetry(state, 3)).toBe(true);
    });
  });

  describe('retry', () => {
    it('computes the delay from the current failure count', async () => {
      const { service, retryDelay } = setup();
      const state = createWorkflowExecutionState({ failureCount: 2 });
      const retryMeta = { maxAttempts: 5 };

      await service.retry(state, retryMeta as never);

      expect(retryDelay.compute).toHaveBeenCalledWith(retryMeta, 2);
    });

    it('treats a missing failure count as the first attempt', async () => {
      const { service, retryDelay } = setup();
      const state = createWorkflowExecutionState({ failureCount: undefined });
      const retryMeta = { maxAttempts: 5 };

      await service.retry(state, retryMeta as never);

      expect(retryDelay.compute).toHaveBeenCalledWith(retryMeta, 1);
    });

    it('schedules the retry and persists the resulting state', async () => {
      const { service, stateService, transitions } = setup();
      const state = createWorkflowExecutionState();

      const result = await service.retry(state, { maxAttempts: 5 } as never);

      expect(transitions.scheduleRetry).toHaveBeenCalledTimes(1);
      expect(stateService.save).toHaveBeenCalledTimes(1);
      expect(result.status).toBe('running');
    });

    it('logs when the persisted state has a retryAt', async () => {
      const { service, logger } = setup();
      const state = createWorkflowExecutionState();

      const result = await service.retry(state, { maxAttempts: 5 } as never);

      expect(logger.retryScheduled).toHaveBeenCalledWith(
        result,
        result.retryAt,
      );
    });
  });
});
