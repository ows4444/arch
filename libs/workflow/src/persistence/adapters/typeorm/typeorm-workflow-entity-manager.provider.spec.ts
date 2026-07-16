import { EntityManager } from 'typeorm';
import { TypeOrmWorkflowEntityManagerProvider } from './typeorm-workflow-entity-manager.provider';
import { TypeOrmWorkflowTransactionContext } from './stores/typeorm-workflow-transaction-context';

describe('TypeOrmWorkflowEntityManagerProvider', () => {
  it('returns the ambient transactional manager when one is active', async () => {
    const context = new TypeOrmWorkflowTransactionContext();
    const ambientManager = { isAmbient: true } as unknown as EntityManager;
    const defaultManager = { isAmbient: false } as unknown as EntityManager;
    const dataSource = { manager: defaultManager } as never;

    const provider = new TypeOrmWorkflowEntityManagerProvider(
      context,
      dataSource,
    );

    await context.run(ambientManager, () => {
      expect(provider.manager()).toBe(ambientManager);
      return Promise.resolve();
    });
  });

  it("falls back to the DataSource's default manager when no transaction is active", () => {
    const context = new TypeOrmWorkflowTransactionContext();
    const defaultManager = { isAmbient: false } as unknown as EntityManager;
    const dataSource = { manager: defaultManager } as never;

    const provider = new TypeOrmWorkflowEntityManagerProvider(
      context,
      dataSource,
    );

    expect(provider.manager()).toBe(defaultManager);
  });
});
