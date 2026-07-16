import { WorkflowFailureService } from './failure.service';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowStepId } from '../../models/workflow-step-id';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { NonRetriableWorkflowError } from '../../errors';

function setup() {
  const persistence = { appendFailure: jest.fn() };
  const transitions = {
    failWorkflow: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        status: 'failed',
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
    load: jest.fn(),
  };
  const retryService = {
    canRetry: jest.fn().mockReturnValue(false),
    retry: jest.fn(),
  };
  const compensation = { compensate: jest.fn() };
  const registry = {
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
  };
  const publisher = { failed: jest.fn() };
  const logger = { failed: jest.fn() };

  let afterCommitCallback: (() => Promise<void>) | undefined;
  const transactionRunner = {
    executeOrJoin: jest.fn((operation: () => unknown) => operation()),
    afterCommit: jest.fn((callback: () => Promise<void>) => {
      afterCommitCallback = callback;
    }),
  };
  const children = {
    findParent: jest.fn().mockResolvedValue(null),
    onChildFailed: jest.fn(),
  };

  const service = new WorkflowFailureService(
    persistence as never,
    transitions as never,
    stateService as never,
    retryService as never,
    compensation as never,
    registry as never,
    publisher as never,
    logger as never,
    transactionRunner as never,
    children as never,
  );

  return {
    service,
    persistence,
    transitions,
    stateService,
    retryService,
    compensation,
    registry,
    publisher,
    logger,
    children,
    getAfterCommitCallback: () => afterCommitCallback,
  };
}

describe('WorkflowFailureService', () => {
  describe('handleFailure', () => {
    it('does nothing when the workflow has no in-flight step', async () => {
      const { service, stateService } = setup();
      const state = createWorkflowExecutionState({
        executingStep: undefined,
        currentStep: undefined,
      });

      await service.handleFailure(state, new Error('boom'));

      expect(stateService.save).not.toHaveBeenCalled();
    });

    it('fails execution when there is an in-flight step', async () => {
      const { service, stateService } = setup();
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.handleFailure(state, new Error('boom'));

      expect(stateService.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('toFailure', () => {
    it('classifies a WorkflowFailureError subtype using its own retriable flag', () => {
      const { service } = setup();
      const error = new NonRetriableWorkflowError('nope');

      const failure = service.toFailure(error);

      expect(failure).toEqual({
        code: 'NonRetriableWorkflowError',
        message: 'nope',
        retriable: false,
      });
    });

    it('falls back to UNKNOWN for plain errors', () => {
      const { service } = setup();

      const failure = service.toFailure(new Error('plain'));

      expect(failure.code).toBe('UNKNOWN');
      expect(failure.retriable).toBe(false);
    });
  });

  describe('failExecution', () => {
    it('persists the failure and notifies a parent workflow when present', async () => {
      const { service, children, stateService } = setup();
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });
      const parent = createWorkflowExecutionState({ workflowId: 'parent-1' });

      stateService.load.mockResolvedValue({ ...state, status: 'failed' });
      children.findParent.mockResolvedValue(parent);

      await service.failExecution(state, new Error('boom'));

      expect(children.onChildFailed).toHaveBeenCalledWith(
        parent,
        expect.objectContaining({ status: 'failed' }),
      );
    });

    it('schedules a retry after commit when the workflow is retriable', async () => {
      const { service, registry, retryService, getAfterCommitCallback } =
        setup();
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          retries: { maxAttempts: 3 },
        },
      });
      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });
      retryService.canRetry.mockReturnValue(true);

      await service.failExecution(state, new Error('boom'));
      await getAfterCommitCallback()?.();

      expect(retryService.retry).toHaveBeenCalledTimes(1);
    });

    it('compensates after commit when retries are exhausted and compensation is enabled', async () => {
      const {
        service,
        registry,
        retryService,
        compensation,
        getAfterCommitCallback,
      } = setup();
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          compensation: { enabled: true },
        },
      });
      retryService.canRetry.mockReturnValue(false);

      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.failExecution(state, new Error('boom'));
      await getAfterCommitCallback()?.();

      expect(compensation.compensate).toHaveBeenCalledTimes(1);
    });

    it('does not let a post-commit failure escape as an unhandled rejection', async () => {
      const { service, publisher, getAfterCommitCallback, logger } = setup();
      publisher.failed.mockRejectedValue(new Error('publish failed'));

      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.failExecution(state, new Error('boom'));

      await expect(getAfterCommitCallback()?.()).resolves.toBeUndefined();
      expect(logger.failed).toHaveBeenCalledTimes(1);
    });

    it('still schedules a retry when publishing the failure event fails', async () => {
      const {
        service,
        registry,
        retryService,
        publisher,
        getAfterCommitCallback,
      } = setup();
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          retries: { maxAttempts: 3 },
        },
      });
      retryService.canRetry.mockReturnValue(true);
      publisher.failed.mockRejectedValue(new Error('publish failed'));

      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.failExecution(state, new Error('boom'));
      await getAfterCommitCallback()?.();

      expect(retryService.retry).toHaveBeenCalledTimes(1);
    });

    it('still compensates when publishing the failure event fails', async () => {
      const {
        service,
        registry,
        retryService,
        compensation,
        publisher,
        getAfterCommitCallback,
      } = setup();
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          compensation: { enabled: true },
        },
      });
      retryService.canRetry.mockReturnValue(false);
      publisher.failed.mockRejectedValue(new Error('publish failed'));

      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.failExecution(state, new Error('boom'));
      await getAfterCommitCallback()?.();

      expect(compensation.compensate).toHaveBeenCalledTimes(1);
    });

    it('still publishes the failure event when retry scheduling throws', async () => {
      const {
        service,
        registry,
        retryService,
        publisher,
        getAfterCommitCallback,
      } = setup();
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          retries: { maxAttempts: 3 },
        },
      });
      retryService.canRetry.mockReturnValue(true);
      retryService.retry.mockRejectedValue(new Error('db write failed'));

      const state = createWorkflowExecutionState({
        executingStep: createWorkflowStepId('step-1'),
      });

      await service.failExecution(state, new Error('boom'));
      await getAfterCommitCallback()?.();

      expect(publisher.failed).toHaveBeenCalledTimes(1);
    });
  });
});
