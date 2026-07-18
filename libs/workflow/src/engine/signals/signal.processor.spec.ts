import { WorkflowSignalProcessor } from './signal.processor';
import { WorkflowExecutionError } from '../../errors/workflow.errors';
import { WorkflowExecutionState } from '../../models/workflow-execution-state';
import { createWorkflowExecutionState } from '../../testing/fixtures/state.factory';

function setup() {
  const idempotency = {
    acquire: jest.fn().mockResolvedValue(true),
    markCompleted: jest.fn(),
  };
  const signals = {
    append: jest.fn().mockResolvedValue(true),
    load: jest.fn(),
    markProcessed: jest.fn(),
    pending: jest.fn(),
  };
  const states = {
    load: jest.fn(),
    save: jest.fn(
      (
        _previous: WorkflowExecutionState,
        next: WorkflowExecutionState,
      ): Promise<WorkflowExecutionState> => Promise.resolve(next),
    ),
  };
  const transitions = {
    resumeFromSignal: jest.fn(
      (state: WorkflowExecutionState): WorkflowExecutionState => ({
        ...state,
        status: 'running',
        currentStep: state.resumeStep,
      }),
    ),
  };
  const registry = {
    get: jest.fn().mockReturnValue({ metadata: { name: 'test-workflow' } }),
  };
  const transactionRunner = {
    executeOrJoin: jest.fn((operation: () => unknown) => operation()),
  };

  const processor = new WorkflowSignalProcessor(
    idempotency as never,
    signals as never,
    states as never,
    transitions as never,
    registry as never,
    transactionRunner as never,
  );

  return { processor, idempotency, signals, states, transitions, registry };
}

const signal = { name: 'approval', signalId: 'signal-1' };

describe('WorkflowSignalProcessor', () => {
  describe('prepare', () => {
    it('throws when the workflow does not exist', async () => {
      const { processor, states } = setup();
      states.load.mockResolvedValue(null);

      await expect(processor.prepare('workflow-1', signal)).rejects.toThrow(
        WorkflowExecutionError,
      );
    });

    it.each(['completed', 'failed', 'cancelled'] as const)(
      'throws when the workflow is already %s',
      async (status) => {
        const { processor, states } = setup();
        states.load.mockResolvedValue(createWorkflowExecutionState({ status }));

        await expect(processor.prepare('workflow-1', signal)).rejects.toThrow(
          WorkflowExecutionError,
        );
      },
    );

    it('rejects an unsupported signal name', async () => {
      const { processor, states, registry } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({ status: 'waiting' }),
      );
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          signals: { supportedSignals: ['other-signal'] },
        },
      });

      await expect(processor.prepare('workflow-1', signal)).rejects.toThrow(
        /not supported/,
      );
    });

    it('rejects signals while running when buffering is disabled', async () => {
      const { processor, states, registry } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({ status: 'running' }),
      );
      registry.get.mockReturnValue({
        metadata: {
          name: 'test-workflow',
          signals: { bufferWhileRunning: false },
        },
      });

      await expect(processor.prepare('workflow-1', signal)).rejects.toThrow(
        /not currently waiting/,
      );
    });

    it('returns acquired=false without appending the signal on a duplicate delivery', async () => {
      const { processor, states, idempotency, signals } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({ status: 'running' }),
      );
      idempotency.acquire.mockResolvedValue(false);

      const result = await processor.prepare('workflow-1', signal);

      expect(result.acquired).toBe(false);
      expect(signals.append).not.toHaveBeenCalled();
    });

    it('appends the signal and leaves a running workflow untouched', async () => {
      const { processor, states, signals, transitions } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({ status: 'running' }),
      );

      const result = await processor.prepare('workflow-1', signal);

      expect(signals.append).toHaveBeenCalledWith('workflow-1', signal);
      expect(transitions.resumeFromSignal).not.toHaveBeenCalled();
      expect(result.acquired).toBe(true);
    });

    it('returns acquired=false without resuming when the signal row was already recorded (regression)', async () => {
      const { processor, states, signals, transitions } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({
          status: 'waiting',
          waitingForSignal: signal,
        }),
      );
      signals.append.mockResolvedValue(false);

      const result = await processor.prepare('workflow-1', signal);

      expect(result.acquired).toBe(false);
      expect(transitions.resumeFromSignal).not.toHaveBeenCalled();
    });

    it('throws when a waiting workflow receives a signal it is not waiting for', async () => {
      const { processor, states } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({
          status: 'waiting',
          waitingForSignal: { name: 'other-signal', signalId: 'x' },
        }),
      );

      await expect(processor.prepare('workflow-1', signal)).rejects.toThrow(
        /is not waiting for/,
      );
    });

    it('resumes a waiting workflow when the expected signal arrives', async () => {
      const { processor, states, transitions } = setup();
      states.load.mockResolvedValue(
        createWorkflowExecutionState({
          status: 'waiting',
          waitingForSignal: signal,
        }),
      );

      const result = await processor.prepare('workflow-1', signal);

      expect(transitions.resumeFromSignal).toHaveBeenCalledTimes(1);
      expect(result.state.status).toBe('running');
    });
  });

  describe('complete', () => {
    it('is a no-op when the signal was already processed', async () => {
      const { processor, signals, idempotency } = setup();
      signals.load.mockResolvedValue({ processed: true });

      await processor.complete('workflow-1', 'signal-1');

      expect(signals.markProcessed).not.toHaveBeenCalled();
      expect(idempotency.markCompleted).not.toHaveBeenCalled();
    });

    it('marks the signal processed and idempotency key completed', async () => {
      const { processor, signals, idempotency } = setup();
      signals.load.mockResolvedValue({ processed: false });

      await processor.complete('workflow-1', 'signal-1');

      expect(signals.markProcessed).toHaveBeenCalledWith(
        'workflow-1',
        'signal-1',
      );
      expect(idempotency.markCompleted).toHaveBeenCalledWith(
        expect.stringContaining('signal-1'),
        'workflow-1',
      );
    });
  });
});
