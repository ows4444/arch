import { EntityManager } from 'typeorm';
import { DatabaseAccessor } from './database-accessor';
import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryResolver } from '../repository/repository-resolver';
import { DataSourceManager } from '../datasource/datasource.manager';
import { transactionContext } from '../transaction/transaction.context';

function fakeDataSourceManager(nonTransactionalManager: EntityManager) {
  return {
    manager: jest.fn().mockReturnValue(nonTransactionalManager),
    dataSource: jest.fn(),
  } as unknown as DataSourceManager;
}

describe('DatabaseAccessor', () => {
  it('resolves the ambient transaction manager for WRITE role inside an active transaction', async () => {
    const nonTransactionalManager = {
      isNonTransactional: true,
    } as unknown as EntityManager;
    const ambientManager = { isAmbient: true } as unknown as EntityManager;

    const dataSourceManager = fakeDataSourceManager(nonTransactionalManager);
    const resolver = new RepositoryResolver(dataSourceManager);
    const accessor = new DatabaseAccessor(DatabaseRole.WRITE, resolver);

    await transactionContext.run(ambientManager, () => {
      expect(accessor.manager()).toBe(ambientManager);
      return Promise.resolve();
    });
  });

  it('does not use the ambient transaction manager outside an active transaction', () => {
    const nonTransactionalManager = {
      isNonTransactional: true,
    } as unknown as EntityManager;

    const dataSourceManager = fakeDataSourceManager(nonTransactionalManager);
    const resolver = new RepositoryResolver(dataSourceManager);
    const accessor = new DatabaseAccessor(DatabaseRole.WRITE, resolver);

    expect(accessor.manager()).toBe(nonTransactionalManager);
    expect(dataSourceManager.manager).toHaveBeenCalledWith(DatabaseRole.WRITE);
  });

  it('does not use the ambient transaction manager for READ role even inside an active transaction', async () => {
    const nonTransactionalManager = {
      isNonTransactional: true,
    } as unknown as EntityManager;
    const ambientManager = { isAmbient: true } as unknown as EntityManager;

    const dataSourceManager = fakeDataSourceManager(nonTransactionalManager);
    const resolver = new RepositoryResolver(dataSourceManager);
    const accessor = new DatabaseAccessor(DatabaseRole.READ, resolver);

    await transactionContext.run(ambientManager, () => {
      expect(accessor.manager()).toBe(nonTransactionalManager);
      return Promise.resolve();
    });
  });

  it('delegates dataSource() to the resolver', () => {
    const dataSourceManager = fakeDataSourceManager({} as EntityManager);
    const resolver = new RepositoryResolver(dataSourceManager);
    const accessor = new DatabaseAccessor(DatabaseRole.READ, resolver);

    accessor.dataSource();

    expect(dataSourceManager.dataSource).toHaveBeenCalledWith(
      DatabaseRole.READ,
    );
  });
});
