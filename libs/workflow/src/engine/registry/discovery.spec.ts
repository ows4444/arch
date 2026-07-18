import { WorkflowDiscovery } from './discovery';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import {
  WORKFLOW_METADATA,
  WORKFLOW_QUERY_METADATA,
  WORKFLOW_STEP_METADATA,
} from '../../constants/workflow.constants';
import { WorkflowMetadata } from '../../definition/workflow-metadata';
import { WorkflowQueryMetadata } from '../../definition/workflow-query-metadata';

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

function setup(
  metadataByType: Map<unknown, WorkflowMetadata>,
  queryMetadataByType: Map<unknown, WorkflowQueryMetadata> = new Map(),
) {
  const providers = [
    ...new Set([...metadataByType.keys(), ...queryMetadataByType.keys()]),
  ].map((metatype) => ({ metatype }));

  const discovery = { getProviders: jest.fn().mockReturnValue(providers) };

  const reflector = {
    get: jest.fn((token: unknown, type: unknown) => {
      if (token === WORKFLOW_METADATA) {
        return metadataByType.get(type);
      }

      if (token === WORKFLOW_STEP_METADATA) {
        return undefined;
      }

      if (token === WORKFLOW_QUERY_METADATA) {
        return queryMetadataByType.get(type);
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

  describe('query registration', () => {
    class SummaryQueryHandler {}
    class DuplicateQueryHandler {}

    it('registers a query handler under the workflow it references', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [WorkflowA, baseMetadata({ name: 'workflow-a' })],
      ]);
      const queryMetadataByType = new Map<unknown, WorkflowQueryMetadata>([
        [SummaryQueryHandler, { workflow: 'workflow-a', name: 'summary' }],
      ]);

      const { workflowDiscovery, registry } = setup(
        metadataByType,
        queryMetadataByType,
      );

      workflowDiscovery.onModuleInit();

      const [registered] = registry.register.mock.calls[0] as [
        { queries: Map<string, unknown> },
      ];
      expect(registered.queries.get('summary')).toBe(SummaryQueryHandler);
    });

    it('throws when two query handlers on the same workflow share a name', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [WorkflowA, baseMetadata({ name: 'workflow-a' })],
      ]);
      const queryMetadataByType = new Map<unknown, WorkflowQueryMetadata>([
        [SummaryQueryHandler, { workflow: 'workflow-a', name: 'summary' }],
        [DuplicateQueryHandler, { workflow: 'workflow-a', name: 'summary' }],
      ]);

      const { workflowDiscovery } = setup(metadataByType, queryMetadataByType);

      expect(() => workflowDiscovery.onModuleInit()).toThrow(
        /Duplicate query 'summary'/,
      );
    });

    it('throws when a query handler references an unknown workflow', () => {
      const metadataByType = new Map<unknown, WorkflowMetadata>([
        [WorkflowA, baseMetadata({ name: 'workflow-a' })],
      ]);
      const queryMetadataByType = new Map<unknown, WorkflowQueryMetadata>([
        [
          SummaryQueryHandler,
          { workflow: 'missing-workflow', name: 'summary' },
        ],
      ]);

      const { workflowDiscovery } = setup(metadataByType, queryMetadataByType);

      expect(() => workflowDiscovery.onModuleInit()).toThrow(
        /references unknown workflow 'missing-workflow'/,
      );
    });
  });
});
