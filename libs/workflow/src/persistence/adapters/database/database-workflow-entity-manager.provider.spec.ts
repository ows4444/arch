import { EntityManager } from 'typeorm';
import { DatabaseRole } from '@/database';
import { DatabaseWorkflowEntityManagerProvider } from './database-workflow-entity-manager.provider';

describe('DatabaseWorkflowEntityManagerProvider', () => {
  it('resolves the WRITE-role manager via RepositoryResolver — never READ', () => {
    const manager = {} as EntityManager;
    const resolver = { manager: jest.fn().mockReturnValue(manager) };

    const provider = new DatabaseWorkflowEntityManagerProvider(
      resolver as never,
    );

    expect(provider.manager()).toBe(manager);
    expect(resolver.manager).toHaveBeenCalledWith(DatabaseRole.WRITE);
    expect(resolver.manager).not.toHaveBeenCalledWith(DatabaseRole.READ);
  });
});
