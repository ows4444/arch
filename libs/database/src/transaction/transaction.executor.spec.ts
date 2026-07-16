import { EntityManager, QueryRunner } from 'typeorm';
import { TransactionExecutor } from './transaction.executor';
import { DataSourceManager } from '../datasource/datasource.manager';
import { transactionContext } from './transaction.context';
import { TransactionPropagation } from './transaction.constants';

function fakeDataSourceManager(
  overrides: {
    transaction?: (
      fn: (manager: EntityManager) => Promise<unknown>,
    ) => Promise<unknown>;
    createQueryRunner?: () => QueryRunner;
  } = {},
): DataSourceManager {
  return {
    dataSource: jest.fn().mockReturnValue({
      transaction: overrides.transaction,
      createQueryRunner: overrides.createQueryRunner,
    }),
  } as unknown as DataSourceManager;
}

function fakeQueryRunner(
  manager: EntityManager = {} as EntityManager,
): QueryRunner {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    startTransaction: jest.fn().mockResolvedValue(undefined),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    rollbackTransaction: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined),
    manager,
  } as unknown as QueryRunner;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TransactionExecutor timeout handling', () => {
  it('resolves normally when the operation finishes before the timeout', async () => {
    const dataSourceManager = fakeDataSourceManager({
      transaction: async (fn) => fn({} as EntityManager),
    });
    const executor = new TransactionExecutor(dataSourceManager);

    await expect(
      executor.execute(() => Promise.resolve('done'), { timeoutMs: 1000 }),
    ).resolves.toBe('done');
  });

  it('does not let the surrounding transaction wrapper release before the real operation finishes, even after the timeout elapses', async () => {
    const events: string[] = [];
    const work = deferred<string>();

    const dataSourceManager = fakeDataSourceManager({
      transaction: async (fn) => {
        try {
          const result = await fn({} as EntityManager);
          events.push('wrapper-settled-commit');
          return result;
        } catch (error) {
          events.push('wrapper-settled-rollback');
          throw error;
        }
      },
    });

    const executor = new TransactionExecutor(dataSourceManager);

    const callback = async (): Promise<string> => {
      events.push('callback-start');
      const result = await work.promise;
      events.push('callback-end');
      return result;
    };

    const executePromise = executor.execute(callback, { timeoutMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(events).toEqual(['callback-start']);

    work.resolve('real-result');

    await expect(executePromise).resolves.toBe('real-result');
    expect(events).toEqual([
      'callback-start',
      'callback-end',
      'wrapper-settled-commit',
    ]);
  });

  it('propagates the operation real failure (not a timeout error) if it fails after timing out', async () => {
    const work = deferred<string>();

    const dataSourceManager = fakeDataSourceManager({
      transaction: async (fn) => fn({} as EntityManager),
    });
    const executor = new TransactionExecutor(dataSourceManager);

    const callback = async (): Promise<string> => work.promise;

    const executePromise = executor.execute(callback, { timeoutMs: 10 });

    await new Promise((resolve) => setTimeout(resolve, 30));

    const realError = new Error('deadlock victim');
    work.reject(realError);

    await expect(executePromise).rejects.toBe(realError);
  });
});

describe('TransactionExecutor propagation: MANDATORY', () => {
  it('throws when there is no active transaction', async () => {
    const executor = new TransactionExecutor(fakeDataSourceManager());

    await expect(
      executor.execute(() => Promise.resolve('x'), {
        propagation: TransactionPropagation.MANDATORY,
      }),
    ).rejects.toThrow(/requires an active transaction/);
  });

  it('runs the callback using the ambient transaction when one is active', async () => {
    const executor = new TransactionExecutor(fakeDataSourceManager());
    const manager = {} as EntityManager;

    await transactionContext.run(manager, () =>
      expect(
        executor.execute(() => Promise.resolve('ok'), {
          propagation: TransactionPropagation.MANDATORY,
        }),
      ).resolves.toBe('ok'),
    );
  });
});

describe('TransactionExecutor propagation: NEVER', () => {
  it('throws when called inside an active transaction', async () => {
    const executor = new TransactionExecutor(fakeDataSourceManager());
    const manager = {} as EntityManager;

    await transactionContext.run(manager, () =>
      expect(
        executor.execute(() => Promise.resolve('x'), {
          propagation: TransactionPropagation.NEVER,
        }),
      ).rejects.toThrow(/must not execute inside an active transaction/),
    );
  });

  it('runs the callback directly, without starting a transaction, when there is no active transaction', async () => {
    const dataSourceManager = fakeDataSourceManager();
    const executor = new TransactionExecutor(dataSourceManager);
    const callback = jest.fn().mockResolvedValue('ok');

    await expect(
      executor.execute(callback, {
        propagation: TransactionPropagation.NEVER,
      }),
    ).resolves.toBe('ok');

    expect(dataSourceManager.dataSource).not.toHaveBeenCalled();
  });
});

describe('TransactionExecutor propagation: SUPPORTS', () => {
  it('runs the callback directly, without starting a transaction, when inactive', async () => {
    const dataSourceManager = fakeDataSourceManager();
    const executor = new TransactionExecutor(dataSourceManager);
    const callback = jest.fn().mockResolvedValue('ok');

    await expect(
      executor.execute(callback, {
        propagation: TransactionPropagation.SUPPORTS,
      }),
    ).resolves.toBe('ok');

    expect(dataSourceManager.dataSource).not.toHaveBeenCalled();
  });

  it('joins the ambient transaction when one is active', async () => {
    const dataSourceManager = fakeDataSourceManager();
    const executor = new TransactionExecutor(dataSourceManager);
    const manager = {} as EntityManager;

    await transactionContext.run(manager, () =>
      expect(
        executor.execute(() => Promise.resolve('ok'), {
          propagation: TransactionPropagation.SUPPORTS,
        }),
      ).resolves.toBe('ok'),
    );

    expect(dataSourceManager.dataSource).not.toHaveBeenCalled();
  });
});

describe('TransactionExecutor propagation: NOT_SUPPORTED', () => {
  it('runs the callback directly, without starting a transaction, when there is nothing to suspend (regression)', async () => {
    const dataSourceManager = fakeDataSourceManager();
    const executor = new TransactionExecutor(dataSourceManager);
    const callback = jest.fn().mockResolvedValue('ok');

    await expect(
      executor.execute(callback, {
        propagation: TransactionPropagation.NOT_SUPPORTED,
      }),
    ).resolves.toBe('ok');

    expect(dataSourceManager.dataSource).not.toHaveBeenCalled();
  });

  it('suspends the ambient transaction while the callback runs, then resumes it', async () => {
    const executor = new TransactionExecutor(fakeDataSourceManager());
    const manager = {} as EntityManager;
    let activeDuringCallback: boolean | undefined;

    await transactionContext.run(manager, async () => {
      await executor.execute(
        () => {
          activeDuringCallback = transactionContext.active;
          return Promise.resolve('ok');
        },
        { propagation: TransactionPropagation.NOT_SUPPORTED },
      );

      expect(transactionContext.active).toBe(true);
      expect(transactionContext.manager).toBe(manager);
    });

    expect(activeDuringCallback).toBe(false);
  });

  it('propagates a callback error after resuming the suspended transaction', async () => {
    const executor = new TransactionExecutor(fakeDataSourceManager());
    const manager = {} as EntityManager;
    const error = new Error('boom');

    await transactionContext.run(manager, async () => {
      await expect(
        executor.execute(() => Promise.reject(error), {
          propagation: TransactionPropagation.NOT_SUPPORTED,
        }),
      ).rejects.toBe(error);

      expect(transactionContext.active).toBe(true);
    });
  });
});

describe('TransactionExecutor propagation: REQUIRES_NEW', () => {
  it('opens a dedicated queryRunner-based transaction and commits on success', async () => {
    const runner = fakeQueryRunner();
    const dataSourceManager = fakeDataSourceManager({
      createQueryRunner: () => runner,
    });
    const executor = new TransactionExecutor(dataSourceManager);

    const result = await executor.execute(() => Promise.resolve('ok'), {
      propagation: TransactionPropagation.REQUIRES_NEW,
    });

    expect(result).toBe('ok');
    expect(runner.connect).toHaveBeenCalledTimes(1);
    expect(runner.startTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1);
    expect(runner.rollbackTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back and releases the queryRunner when the callback fails', async () => {
    const runner = fakeQueryRunner();
    const dataSourceManager = fakeDataSourceManager({
      createQueryRunner: () => runner,
    });
    const executor = new TransactionExecutor(dataSourceManager);
    const error = new Error('boom');

    await expect(
      executor.execute(() => Promise.reject(error), {
        propagation: TransactionPropagation.REQUIRES_NEW,
      }),
    ).rejects.toBe(error);

    expect(runner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(runner.commitTransaction).not.toHaveBeenCalled();
    expect(runner.release).toHaveBeenCalledTimes(1);
  });

  it('suspends any ambient transaction so the callback only sees the new queryRunner-bound manager', async () => {
    const newManager = { isNew: true } as unknown as EntityManager;
    const runner = fakeQueryRunner(newManager);
    const dataSourceManager = fakeDataSourceManager({
      createQueryRunner: () => runner,
    });
    const executor = new TransactionExecutor(dataSourceManager);
    const outerManager = { isOuter: true } as unknown as EntityManager;

    let managerDuringCallback: EntityManager | undefined;

    await transactionContext.run(outerManager, () =>
      executor.execute(
        () => {
          managerDuringCallback = transactionContext.manager;
          return Promise.resolve('ok');
        },
        { propagation: TransactionPropagation.REQUIRES_NEW },
      ),
    );

    expect(managerDuringCallback).toBe(newManager);
  });
});

describe('TransactionExecutor propagation: NESTED', () => {
  it('creates and releases a savepoint on success', async () => {
    const runner = fakeQueryRunner();
    const manager = { queryRunner: runner } as unknown as EntityManager;
    const executor = new TransactionExecutor(fakeDataSourceManager());

    const result = await transactionContext.run(manager, () =>
      executor.execute(() => Promise.resolve('ok'), {
        propagation: TransactionPropagation.NESTED,
      }),
    );

    expect(result).toBe('ok');
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/^SAVEPOINT sp_\d+$/),
    );
    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/^RELEASE SAVEPOINT sp_\d+$/),
    );
  });

  it('rolls back to the savepoint and rethrows on failure', async () => {
    const runner = fakeQueryRunner();
    const manager = { queryRunner: runner } as unknown as EntityManager;
    const executor = new TransactionExecutor(fakeDataSourceManager());
    const error = new Error('boom');

    await expect(
      transactionContext.run(manager, () =>
        executor.execute(() => Promise.reject(error), {
          propagation: TransactionPropagation.NESTED,
        }),
      ),
    ).rejects.toBe(error);

    expect(runner.query).toHaveBeenCalledWith(
      expect.stringMatching(/^ROLLBACK TO SAVEPOINT sp_\d+$/),
    );
  });

  it('falls back to running the callback directly when the ambient manager has no queryRunner', async () => {
    const manager = { queryRunner: undefined } as unknown as EntityManager;
    const executor = new TransactionExecutor(fakeDataSourceManager());

    const result = await transactionContext.run(manager, () =>
      executor.execute(() => Promise.resolve('ok'), {
        propagation: TransactionPropagation.NESTED,
      }),
    );

    expect(result).toBe('ok');
  });

  it('starts a fresh transaction when NESTED is requested with no active transaction', async () => {
    const dataSourceManager = fakeDataSourceManager({
      transaction: async (fn) => fn({} as EntityManager),
    });
    const executor = new TransactionExecutor(dataSourceManager);

    await expect(
      executor.execute(() => Promise.resolve('ok'), {
        propagation: TransactionPropagation.NESTED,
      }),
    ).resolves.toBe('ok');

    expect(dataSourceManager.dataSource).toHaveBeenCalled();
  });
});
