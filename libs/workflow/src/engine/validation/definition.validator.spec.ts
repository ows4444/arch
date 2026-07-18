import { WorkflowDefinitionValidator } from './definition.validator';
import { RegisteredWorkflow } from '../../models/registered-workflow';
import { createWorkflowStepId } from '../../models/workflow-step-id';

class WorkflowClass {}
class OtherWorkflowClass {}
class StepHandler {}

function workflow(
  overrides: {
    metadata?: Record<string, unknown>;
    steps?: [string, Record<string, unknown>?][];
    transitions?: Partial<Record<string, readonly string[]>>;
    start?: string;
  } = {},
): RegisteredWorkflow {
  const stepEntries = overrides.steps ?? [['step-1', {}]];
  const start = overrides.start ?? stepEntries[0]?.[0] ?? 'step-1';

  const steps = new Map(
    stepEntries.map(([id, meta]) => [
      createWorkflowStepId(id),
      {
        metadata: {
          workflow: 'test-workflow',
          step: createWorkflowStepId(id),
          ...meta,
        },
        type: StepHandler,
      },
    ]),
  );

  return {
    metadata: {
      name: 'test-workflow',
      version: 1,
      definition: {
        start: createWorkflowStepId(start),
        transitions: overrides.transitions ?? {},
      },
      ...overrides.metadata,
    },
    workflowType: WorkflowClass,
    steps,
    transitions: new Map(),
  } as unknown as RegisteredWorkflow;
}

describe('WorkflowDefinitionValidator', () => {
  const validator = new WorkflowDefinitionValidator();

  it('accepts a minimal valid single-step workflow', () => {
    expect(() => validator.validate(workflow())).not.toThrow();
  });

  it('accepts a valid multi-step linear workflow', () => {
    const wf = workflow({
      steps: [
        ['step-1', {}],
        ['step-2', {}],
      ],
      transitions: { 'step-1': ['step-2'] },
    });

    expect(() => validator.validate(wf)).not.toThrow();
  });

  describe('start step', () => {
    it('throws when the start step is not a registered step', () => {
      const wf = workflow({ start: 'missing-step' });

      expect(() => validator.validate(wf)).toThrow(
        /start step 'missing-step' does not exist/,
      );
    });
  });

  describe('transitions', () => {
    it('throws when a transition source is not a registered step', () => {
      const wf = workflow({ transitions: { 'unknown-source': ['step-1'] } });

      expect(() => validator.validate(wf)).toThrow(
        /transition source 'unknown-source' does not exist/,
      );
    });

    it('throws when a transition target is not a registered step', () => {
      const wf = workflow({ transitions: { 'step-1': ['unknown-target'] } });

      expect(() => validator.validate(wf)).toThrow(
        /transition target 'unknown-target' does not exist/,
      );
    });
  });

  describe('reachability', () => {
    it('throws when a declared step is unreachable from the start step', () => {
      const wf = workflow({
        steps: [
          ['step-1', {}],
          ['step-2', {}],
        ],
        transitions: {},
      });

      expect(() => validator.validate(wf)).toThrow(/unreachable step 'step-2'/);
    });
  });

  describe('cycles', () => {
    it('throws when the transition graph contains a cycle', () => {
      const wf = workflow({
        steps: [
          ['step-1', {}],
          ['step-2', {}],
        ],
        transitions: { 'step-1': ['step-2'], 'step-2': ['step-1'] },
      });

      expect(() => validator.validate(wf)).toThrow(/contains a cycle/);
    });

    it('allows a cycle when allowCycles is set', () => {
      const wf = workflow({
        steps: [
          ['step-1', {}],
          ['step-2', {}],
        ],
        transitions: { 'step-1': ['step-2'], 'step-2': ['step-1'] },
        metadata: {
          definition: {
            start: createWorkflowStepId('step-1'),
            transitions: { 'step-1': ['step-2'], 'step-2': ['step-1'] },
            allowCycles: true,
          },
        },
      });

      expect(() => validator.validate(wf)).not.toThrow();
    });
  });

  describe('terminal steps', () => {
    it('accepts a workflow with at least one terminal (no-outgoing-transition) step', () => {
      const wf = workflow({
        steps: [
          ['step-1', {}],
          ['step-2', {}],
        ],
        transitions: { 'step-1': ['step-2'] },
      });

      expect(() => validator.validate(wf)).not.toThrow();
    });

    // Note: a workflow with zero terminal steps and no cycle is impossible
    // in a finite graph (following out-edges from any node must eventually
    // revisit one, by pigeonhole), so `validateTerminalSteps`'s own throw
    // is only reachable in principle — `validateCycles` (which runs first)
    // always catches a missing-terminal-step graph as a cycle instead. Not
    // changing this — it's a harmless belt-and-suspenders check, not a bug.
  });

  describe('retry policy', () => {
    it('throws when maxAttempts is less than 1', () => {
      const wf = workflow({ metadata: { retries: { maxAttempts: 0 } } });

      expect(() => validator.validate(wf)).toThrow(/maxAttempts must be >= 1/);
    });

    it('throws when maxAttempts exceeds the maximum', () => {
      const wf = workflow({ metadata: { retries: { maxAttempts: 1_001 } } });

      expect(() => validator.validate(wf)).toThrow(/must be <= 1000/);
    });

    it('throws when maxDelayMs is less than delayMs', () => {
      const wf = workflow({
        metadata: {
          retries: { maxAttempts: 3, delayMs: 5_000, maxDelayMs: 1_000 },
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /maxDelayMs.*must be >= retries.delayMs/,
      );
    });

    it('throws when maxDelayMs is set with a fixed strategy', () => {
      const wf = workflow({
        metadata: {
          retries: { maxAttempts: 3, strategy: 'fixed', maxDelayMs: 5_000 },
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /maxDelayMs is not applicable when strategy is 'fixed'/,
      );
    });

    it('accepts a valid exponential retry policy', () => {
      const wf = workflow({
        metadata: {
          retries: {
            maxAttempts: 3,
            strategy: 'exponential',
            delayMs: 1_000,
            maxDelayMs: 10_000,
          },
        },
      });

      expect(() => validator.validate(wf)).not.toThrow();
    });
  });

  describe('timeouts', () => {
    it('throws when defaultStepTimeoutMs is not a positive finite number', () => {
      const wf = workflow({ metadata: { defaultStepTimeoutMs: -1 } });

      expect(() => validator.validate(wf)).toThrow(
        /must be a positive finite number/,
      );
    });

    it('throws when a step timeoutMs exceeds the maximum duration', () => {
      const wf = workflow({
        steps: [['step-1', { timeoutMs: 366 * 24 * 60 * 60 * 1000 }]],
      });

      expect(() => validator.validate(wf)).toThrow(/365 days/);
    });
  });

  describe('signals', () => {
    it('throws when a supported signal name is empty', () => {
      const wf = workflow({
        metadata: { signals: { supportedSignals: [''] } },
      });

      expect(() => validator.validate(wf)).toThrow(
        /declares an empty signal name/,
      );
    });

    it('throws when supportedSignals has a duplicate', () => {
      const wf = workflow({
        metadata: { signals: { supportedSignals: ['a', 'a'] } },
      });

      expect(() => validator.validate(wf)).toThrow(
        /declares duplicate signal 'a'/,
      );
    });

    it('throws when signals.defaultTimeoutMs exceeds the maximum', () => {
      const wf = workflow({
        metadata: {
          signals: { defaultTimeoutMs: 366 * 24 * 60 * 60 * 1000 },
        },
      });

      // `validatePositiveDuration`'s generic "must be <= ...365 days" check
      // runs before (and always fires ahead of) the dedicated "Signal
      // expiry would be effectively disabled" message a few lines later in
      // `validateSignals` — that second check is unreachable dead code, see
      // LOOP.md. Asserting on the message that actually fires.
      expect(() => validator.validate(wf)).toThrow(/365 days/);
    });
  });

  describe('deprecated steps', () => {
    it('throws when the start step is deprecated', () => {
      const wf = workflow({ steps: [['step-1', { deprecated: true }]] });

      expect(() => validator.validate(wf)).toThrow(
        /cannot start on deprecated step/,
      );
    });

    it('throws when replacedBy references an unknown step', () => {
      const wf = workflow({
        steps: [
          ['step-1', {}],
          ['step-2', { replacedBy: createWorkflowStepId('missing') }],
        ],
        transitions: { 'step-1': ['step-2'] },
      });

      expect(() => validator.validate(wf)).toThrow(
        /replaces unknown step 'missing'/,
      );
    });

    it('throws when a step replaces itself', () => {
      const wf = workflow({
        steps: [['step-1', { replacedBy: createWorkflowStepId('step-1') }]],
      });

      expect(() => validator.validate(wf)).toThrow(/cannot replace itself/);
    });
  });

  describe('child workflows', () => {
    function withChild(child: Record<string, unknown>) {
      return workflow({
        metadata: {
          childWorkflows: [{ workflow: OtherWorkflowClass, ...child }],
        },
      });
    }

    it('throws when the same child workflow is declared more than once', () => {
      const wf = workflow({
        metadata: {
          childWorkflows: [
            {
              workflow: OtherWorkflowClass,
              failurePolicy: 'ignore',
              cancellationPolicy: 'detach',
            },
            {
              workflow: OtherWorkflowClass,
              failurePolicy: 'ignore',
              cancellationPolicy: 'detach',
            },
          ],
        },
      });

      expect(() => validator.validate(wf)).toThrow(/more than once/);
    });

    it('throws when a workflow declares itself as a child', () => {
      const wf = workflow({
        metadata: {
          childWorkflows: [
            {
              workflow: WorkflowClass,
              failurePolicy: 'ignore',
              cancellationPolicy: 'detach',
            },
          ],
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /cannot declare itself as a child workflow/,
      );
    });

    it('throws when compensate-parent is used without compensation enabled', () => {
      const wf = withChild({
        failurePolicy: 'compensate-parent',
        cancellationPolicy: 'detach',
      });

      expect(() => validator.validate(wf)).toThrow(
        /does not have compensation enabled/,
      );
    });

    it('accepts compensate-parent when compensation is enabled', () => {
      const wf = workflow({
        metadata: {
          compensation: { enabled: true, strategy: 'reverse-order' },
          childWorkflows: [
            {
              workflow: OtherWorkflowClass,
              failurePolicy: 'compensate-parent',
              cancellationPolicy: 'detach',
            },
          ],
          persistence: { snapshotEvery: 1 },
        },
      });

      expect(() => validator.validate(wf)).not.toThrow();
    });

    it('throws when maxRetries is set but failurePolicy is not retry-child', () => {
      const wf = withChild({
        failurePolicy: 'ignore',
        cancellationPolicy: 'detach',
        maxRetries: 3,
      });

      expect(() => validator.validate(wf)).toThrow(
        /only applicable when failurePolicy is 'retry-child'/,
      );
    });

    it('throws when maxRetries is not a positive integer', () => {
      const wf = withChild({
        failurePolicy: 'retry-child',
        cancellationPolicy: 'detach',
        maxRetries: 0,
      });

      expect(() => validator.validate(wf)).toThrow(
        /maxRetries must be a positive integer/,
      );
    });
  });

  describe('compensation', () => {
    it('throws when custom compensation strategy has no order', () => {
      const wf = workflow({
        metadata: { compensation: { enabled: true, strategy: 'custom' } },
      });

      expect(() => validator.validate(wf)).toThrow(
        /custom compensation without defining an order/,
      );
    });

    it('throws when compensation order references an unknown step', () => {
      const wf = workflow({
        metadata: {
          compensation: {
            enabled: true,
            strategy: 'custom',
            order: [createWorkflowStepId('missing')],
          },
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /references unknown compensation step 'missing'/,
      );
    });
  });

  describe('cross-field compatibility', () => {
    it('throws when retention.ttlMs is less than autoResume.stuckThresholdMs', () => {
      const wf = workflow({
        metadata: {
          retention: { ttlMs: 1_000 },
          autoResume: { stuckThresholdMs: 5_000 },
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /retention.ttlMs must be greater than or equal to autoResume.stuckThresholdMs/,
      );
    });

    it('throws when compensation is enabled without persistence.snapshotEvery configured', () => {
      const wf = workflow({
        metadata: {
          compensation: { enabled: true, strategy: 'reverse-order' },
        },
      });

      expect(() => validator.validate(wf)).toThrow(
        /enables compensation but persistence.snapshotEvery is not configured/,
      );
    });
  });

  describe('auto-resume / persistence / retention numeric bounds', () => {
    it('throws when autoResume.maxAttempts exceeds the maximum', () => {
      const wf = workflow({
        metadata: { autoResume: { maxAttempts: 1_001 } },
      });

      expect(() => validator.validate(wf)).toThrow(/must be <= 1000/);
    });

    it('throws when persistence.snapshotEvery is not a positive integer', () => {
      const wf = workflow({
        metadata: { persistence: { snapshotEvery: 0 } },
      });

      expect(() => validator.validate(wf)).toThrow(
        /must be a positive integer/,
      );
    });

    it('throws when retention.batchSize is not a positive integer', () => {
      const wf = workflow({
        metadata: { retention: { ttlMs: 10_000, batchSize: -1 } },
      });

      expect(() => validator.validate(wf)).toThrow(
        /must be a positive integer/,
      );
    });
  });
});
