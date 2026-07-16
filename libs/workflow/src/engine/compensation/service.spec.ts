import { WorkflowCompensationService } from './service';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../models/workflow-step-id';

class StepAHandler {}
class StepBHandler {}

function setup() {
  const history = { findByWorkflowId: jest.fn() };
  const resolver = { resolveCompensation: jest.fn() };
  const service = new WorkflowCompensationService(
    history as never,
    resolver as never,
  );

  return { service, history, resolver };
}

function step(id: string, handlerType: unknown) {
  return {
    metadata: { compensation: { handler: handlerType } },
  };
}

describe('WorkflowCompensationService', () => {
  const state = createWorkflowExecutionState();

  it('compensates completed steps in reverse order for the default strategy', async () => {
    const { service, history, resolver } = setup();
    const order: string[] = [];

    history.findByWorkflowId.mockResolvedValue([
      { step: createWorkflowStepId('step-a'), status: 'completed' },
      { step: createWorkflowStepId('step-b'), status: 'completed' },
    ]);

    resolver.resolveCompensation.mockImplementation((handlerType: unknown) => ({
      compensate: jest.fn(() => {
        order.push(handlerType === StepAHandler ? 'step-a' : 'step-b');
        return Promise.resolve();
      }),
    }));

    const workflow = {
      metadata: { compensation: { strategy: 'reverse-order' } },
      steps: new Map([
        ['step-a', step('step-a', StepAHandler)],
        ['step-b', step('step-b', StepBHandler)],
      ]),
    };

    await service.compensate(workflow as never, state);

    expect(order).toEqual(['step-b', 'step-a']);
  });

  it('skips steps that have no compensation handler configured', async () => {
    const { service, history, resolver } = setup();

    history.findByWorkflowId.mockResolvedValue([
      { step: createWorkflowStepId('step-a'), status: 'completed' },
    ]);

    const workflow = {
      metadata: { compensation: { strategy: 'reverse-order' } },
      steps: new Map([['step-a', { metadata: {} }]]),
    };

    await service.compensate(workflow as never, state);

    expect(resolver.resolveCompensation).not.toHaveBeenCalled();
  });

  it('continues compensating remaining steps when one handler throws', async () => {
    const { service, history, resolver } = setup();
    const compensateB = jest.fn().mockResolvedValue(undefined);

    history.findByWorkflowId.mockResolvedValue([
      { step: createWorkflowStepId('step-a'), status: 'completed' },
      { step: createWorkflowStepId('step-b'), status: 'completed' },
    ]);

    resolver.resolveCompensation
      .mockReturnValueOnce({
        compensate: jest.fn().mockRejectedValue(new Error('boom')),
      })
      .mockReturnValueOnce({ compensate: compensateB });

    const workflow = {
      metadata: { compensation: { strategy: 'reverse-order' } },
      steps: new Map([
        ['step-a', step('step-a', StepAHandler)],
        ['step-b', step('step-b', StepBHandler)],
      ]),
    };

    await expect(
      service.compensate(workflow as never, state),
    ).resolves.toBeUndefined();

    expect(compensateB).toHaveBeenCalledTimes(1);
  });

  it('follows the declared custom order and ignores steps missing from history', async () => {
    const { service, history, resolver } = setup();
    const calls: string[] = [];

    history.findByWorkflowId.mockResolvedValue([
      { step: createWorkflowStepId('step-a'), status: 'completed' },
      { step: createWorkflowStepId('step-b'), status: 'completed' },
    ]);

    resolver.resolveCompensation.mockImplementation((handlerType: unknown) => ({
      compensate: jest.fn(() => {
        calls.push(handlerType === StepAHandler ? 'step-a' : 'step-b');
        return Promise.resolve();
      }),
    }));

    const workflow = {
      metadata: {
        compensation: {
          strategy: 'custom',
          order: ['step-b', 'step-missing', 'step-a'],
        },
      },
      steps: new Map([
        ['step-a', step('step-a', StepAHandler)],
        ['step-b', step('step-b', StepBHandler)],
      ]),
    };

    await service.compensate(workflow as never, state);

    expect(calls).toEqual(['step-b', 'step-a']);
  });

  it('does not let a hanging handler block later compensation steps', async () => {
    jest.useFakeTimers();

    const { service, history, resolver } = setup();
    const compensateB = jest.fn().mockResolvedValue(undefined);

    history.findByWorkflowId.mockResolvedValue([
      { step: createWorkflowStepId('step-a'), status: 'completed' },
      { step: createWorkflowStepId('step-b'), status: 'completed' },
    ]);

    resolver.resolveCompensation
      .mockReturnValueOnce({
        compensate: jest.fn(() => new Promise(() => {})),
      })
      .mockReturnValueOnce({ compensate: compensateB });

    const workflow = {
      metadata: { compensation: { strategy: 'reverse-order' } },
      steps: new Map([
        ['step-a', step('step-a', StepAHandler)],
        ['step-b', step('step-b', StepBHandler)],
      ]),
    };

    const compensation = service.compensate(workflow as never, state);

    await jest.runAllTimersAsync();
    await compensation;

    expect(compensateB).toHaveBeenCalledTimes(1);

    jest.useRealTimers();
  });

  it('throws when custom strategy is selected without a compensation order', async () => {
    const { service, history } = setup();

    history.findByWorkflowId.mockResolvedValue([]);

    const workflow = {
      metadata: { name: 'wf', compensation: { strategy: 'custom' } },
      steps: new Map(),
    };

    await expect(service.compensate(workflow as never, state)).rejects.toThrow(
      /custom compensation but no compensation order/,
    );
  });
});
