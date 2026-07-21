import { DataSource } from 'typeorm';
import { TransactionExecutor } from './transaction.executor';
import { DataSourceManager } from '../datasource/datasource.manager';
import {
  runOnTransactionCommit,
  runOnTransactionRollback,
  runOnTransactionComplete,
} from './transaction.hooks';

describe('TransactionExecutor + transaction hooks (real DataSource)', () => {
  let dataSource: DataSource;
  let executor: TransactionExecutor;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [],
      synchronize: true,
      dropSchema: true,
    });

    await dataSource.initialize();

    const dataSourceManager = {
      dataSource: () => dataSource,
    } as unknown as DataSourceManager;

    executor = new TransactionExecutor(dataSourceManager);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('fires a runOnTransactionCommit() hook when the transaction commits', async () => {
    let fired = false;

    const result = await executor.execute(() => {
      runOnTransactionCommit(() => {
        fired = true;
      });

      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
    expect(fired).toBe(true);
  });

  it('fires a runOnTransactionRollback() hook when the callback throws', async () => {
    let firedWith: Error | undefined;

    await expect(
      executor.execute(() => {
        runOnTransactionRollback((error) => {
          firedWith = error;
        });

        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(firedWith).toBeInstanceOf(Error);
    expect(firedWith?.message).toBe('boom');
  });

  it('fires a runOnTransactionComplete() hook on both commit and rollback', async () => {
    let completeCount = 0;

    await executor.execute(() => {
      runOnTransactionComplete(() => {
        completeCount++;
      });

      return Promise.resolve('ok');
    });

    await expect(
      executor.execute(() => {
        runOnTransactionComplete(() => {
          completeCount++;
        });

        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(completeCount).toBe(2);
  });

  it('does not fire the commit hook when the transaction rolls back', async () => {
    let commitFired = false;

    await expect(
      executor.execute(() => {
        runOnTransactionCommit(() => {
          commitFired = true;
        });

        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(commitFired).toBe(false);
  });

  it('fires the commit hook strictly after the physical COMMIT succeeds, not merely after the callback returns', async () => {
    const events: string[] = [];

    const originalCreateQueryRunner =
      dataSource.createQueryRunner.bind(dataSource);

    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation(
        (...args: Parameters<DataSource['createQueryRunner']>) => {
          const runner = originalCreateQueryRunner(...args);
          const originalCommit = runner.commitTransaction.bind(runner);

          runner.commitTransaction = async (...commitArgs) => {
            events.push('physical-commit');
            return originalCommit(...commitArgs);
          };

          return runner;
        },
      );

    const result = await executor.execute(() => {
      events.push('callback');

      runOnTransactionCommit(() => {
        events.push('commit-hook');
      });

      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
    expect(events).toEqual(['callback', 'physical-commit', 'commit-hook']);
  });

  it('fires the rollback hook strictly after the physical ROLLBACK, when the callback throws', async () => {
    const events: string[] = [];

    const originalCreateQueryRunner =
      dataSource.createQueryRunner.bind(dataSource);

    jest
      .spyOn(dataSource, 'createQueryRunner')
      .mockImplementation(
        (...args: Parameters<DataSource['createQueryRunner']>) => {
          const runner = originalCreateQueryRunner(...args);
          const originalRollback = runner.rollbackTransaction.bind(runner);

          runner.rollbackTransaction = async (...rollbackArgs) => {
            events.push('physical-rollback');
            return originalRollback(...rollbackArgs);
          };

          return runner;
        },
      );

    await expect(
      executor.execute(() => {
        events.push('callback');

        runOnTransactionRollback(() => {
          events.push('rollback-hook');
        });

        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(events).toEqual(['callback', 'physical-rollback', 'rollback-hook']);
  });
});
