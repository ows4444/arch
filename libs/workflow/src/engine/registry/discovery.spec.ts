import { WorkflowDiscovery } from './discovery';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import {
  WORKFLOW_METADATA,
  WORKFLOW_STEP_METADATA,
} from '../../constants/workflow.constants';
import { WorkflowMetadata } from '../../definition/workflow-metadata';

class WorkflowA {}
class WorkflowB {}
class WorkflowC {}

function baseMetadata(
  overrides: Partial<WorkflowMetadata> = {},
): WorkflowMetadata {
  return {
    name: 'workflow',
    version: 1,
    definition: {
      start: 'start',
      transitions: {},
    },
    ...overrides,
  } as WorkflowMetadata;
}

function setup(metadataByType: Map<unknown, WorkflowMetadata>) {
  const providers = [...metadataByType.keys()].map((metatype) => ({
    metatype,
  }));

  const discovery = { getProviders: jest.fn().mockReturnValue(providers) };

  const reflector = {
    get: jest.fn((token: unknown, type: unknown) => {
      if (token === WORKFLOW_METADATA) {
        return metadataByType.get(type);
      }

      if (token === WORKFLOW_STEP_METADATA) {
        return undefined;
      }

      return undefined;
    }),
  };

  const registry = { register: jest.fn() };
  const validator = { validate: jest.fn() };

  const workflowDiscovery = new WorkflowDiscovery(
    discovery as never,
    reflector as never,
    registry as never,
    validator as never,
  );

  return { workflowDiscovery, registry, validator };
}

describe('WorkflowDiscovery', () => {
  describe('child workflow cycle detection', () => {
    it('throws on a direct two-workflow cycle (A -> B -> A)', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [
          WorkflowA,
          baseMetadata({
            name: 'workflow-a',
            childWorkflows: [
              {
                workflow: WorkflowB,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
        [
          WorkflowB,
          baseMetadata({
            name: 'workflow-b',
            childWorkflows: [
              {
                workflow: WorkflowA,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
      ]);

      const { workflowDiscovery } = setup(metadataByType);

      expect(() => workflowDiscovery.onModuleInit()).toThrow(
        WorkflowConfigurationError,
      );
    });

    it('throws on a longer cycle (A -> B -> C -> A) that a direct-pair check would miss', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [
          WorkflowA,
          baseMetadata({
            name: 'workflow-a',
            childWorkflows: [
              {
                workflow: WorkflowB,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
        [
          WorkflowB,
          baseMetadata({
            name: 'workflow-b',
            childWorkflows: [
              {
                workflow: WorkflowC,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
        [
          WorkflowC,
          baseMetadata({
            name: 'workflow-c',
            childWorkflows: [
              {
                workflow: WorkflowA,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
      ]);

      const { workflowDiscovery } = setup(metadataByType);

      expect(() => workflowDiscovery.onModuleInit()).toThrow(
        WorkflowConfigurationError,
      );
    });

    it('does not flag a non-circular child workflow chain (A -> B -> C)', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [
          WorkflowA,
          baseMetadata({
            name: 'workflow-a',
            childWorkflows: [
              {
                workflow: WorkflowB,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
        [
          WorkflowB,
          baseMetadata({
            name: 'workflow-b',
            childWorkflows: [
              {
                workflow: WorkflowC,
                failurePolicy: 'ignore',
                cancellationPolicy: 'detach',
              },
            ],
          }),
        ],
        [WorkflowC, baseMetadata({ name: 'workflow-c' })],
      ]);

      const { workflowDiscovery, registry } = setup(metadataByType);

      workflowDiscovery.onModuleInit();

      expect(registry.register).toHaveBeenCalledTimes(3);
    });
  });
});
