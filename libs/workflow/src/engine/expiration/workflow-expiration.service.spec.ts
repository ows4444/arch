import { WorkflowExpirationService } from './workflow-expiration.service';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const stateService = { cancel: jest.fn() };
  const registry = {
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
  };
  const children = { cancelChildren: jest.fn() };

  let afterCommitCallback: (() => Promise<void>) | undefined;
  const transactionRunner = {
    executeOrJoin: jest.fn((operation: () => unknown) => operation()),
    afterCommit: jest.fn((callback: () => Promise<void>) => {
      afterCommitCallback = callback;
    }),
  };

  const service = new WorkflowExpirationService(
    stateService as never,
    registry as never,
    children as never,
    transactionRunner as never,
  );

  return {
    service,
    stateService,
    registry,
    children,
    transactionRunner,
    getAfterCommitCallback: () => afterCommitCallback,
  };
}

describe('WorkflowExpirationService', () => {
  it('cancels the workflow as expired', async () => {
    const { service, stateService } = setup();
    stateService.cancel.mockResolvedValue(createWorkflowExecutionState());

    await service.expire('workflow-1');

    expect(stateService.cancel).toHaveBeenCalledWith('workflow-1', true);
  });

  it('cancels managed children only after the expiration commits', async () => {
    const { service, stateService, children, getAfterCommitCallback } = setup();
    const cancelled = createWorkflowExecutionState({ status: 'cancelled' });
    stateService.cancel.mockResolvedValue(cancelled);

    await service.expire('workflow-1');

    expect(children.cancelChildren).not.toHaveBeenCalled();

    await getAfterCommitCallback()?.();

    expect(children.cancelChildren).toHaveBeenCalledWith(
      { metadata: { name: 'test-workflow' } },
      cancelled,
    );
  });
});
