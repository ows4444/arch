import { WorkflowRegistry } from './registry';
import { WorkflowConfigurationError } from '../../errors/workflow.errors';
import { RegisteredWorkflow } from '../../models/registered-workflow';

function workflow(name: string, version: number): RegisteredWorkflow {
  return {
    metadata: { name, version },
    workflowType: class {},
    steps: new Map(),
    transitions: new Map(),
  } as never;
}

describe('WorkflowRegistry', () => {
  it('registers and retrieves a workflow by name and version', () => {
    const registry = new WorkflowRegistry();
    const wf = workflow('order', 1);

    registry.register(wf);

    expect(registry.get('order', 1)).toBe(wf);
  });

  it('throws when registering a duplicate name/version pair', () => {
    const registry = new WorkflowRegistry();
    registry.register(workflow('order', 1));

    expect(() => registry.register(workflow('order', 1))).toThrow(
      WorkflowConfigurationError,
    );
  });

  it('allows the same name at different versions', () => {
    const registry = new WorkflowRegistry();
    registry.register(workflow('order', 1));
    registry.register(workflow('order', 2));

    expect(registry.get('order', 1).metadata.version).toBe(1);
    expect(registry.get('order', 2).metadata.version).toBe(2);
  });

  it('throws when getting an unregistered workflow', () => {
    const registry = new WorkflowRegistry();

    expect(() => registry.get('missing', 1)).toThrow(
      WorkflowConfigurationError,
    );
  });

  describe('getLatest', () => {
    it('returns the highest version registered for a name', () => {
      const registry = new WorkflowRegistry();
      registry.register(workflow('order', 1));
      registry.register(workflow('order', 3));
      registry.register(workflow('order', 2));

      expect(registry.getLatest('order').metadata.version).toBe(3);
    });

    it('throws when no version of the workflow is registered', () => {
      const registry = new WorkflowRegistry();

      expect(() => registry.getLatest('missing')).toThrow(
        WorkflowConfigurationError,
      );
    });
  });

  describe('resolve', () => {
    it('resolves to the latest version when none is specified', () => {
      const registry = new WorkflowRegistry();
      registry.register(workflow('order', 1));
      registry.register(workflow('order', 2));

      expect(registry.resolve('order').metadata.version).toBe(2);
    });

    it('resolves to the specific version when provided', () => {
      const registry = new WorkflowRegistry();
      registry.register(workflow('order', 1));
      registry.register(workflow('order', 2));

      expect(registry.resolve('order', 1).metadata.version).toBe(1);
    });
  });

  describe('getAll', () => {
    it('returns every registered workflow across names and versions', () => {
      const registry = new WorkflowRegistry();
      registry.register(workflow('order', 1));
      registry.register(workflow('shipment', 1));

      expect(registry.getAll()).toHaveLength(2);
    });

    it('returns an empty array when nothing is registered', () => {
      const registry = new WorkflowRegistry();

      expect(registry.getAll()).toEqual([]);
    });
  });
});
