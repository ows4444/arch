import { EntityManager, ObjectLiteral } from 'typeorm';
import { BaseRepository } from './base.repository';
import { RepositoryResolver } from './repository-resolver';
import { DatabaseRole } from '../constants/database-role.enum';
import { transactionContext } from '../transaction/transaction.context';
import type { DataSourceState } from '../interfaces/datasource-state';

interface TestEntity extends ObjectLiteral {
  id: number;
}

class TestRepository extends BaseRepository<TestEntity> {
  protected readonly entity = class {} as never;

  callFindOneForUpdate() {
    return this.findOneForUpdate('t', { id: 1 });
  }

  callFindOneForShare() {
    return this.findOneForShare('t', { id: 1 });
  }
}

function fakeQueryBuilder() {
  const builder = {
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue({ id: 1 }),
  };
  return builder;
}

function fakeResolver(queryBuilder = fakeQueryBuilder()): RepositoryResolver {
  return {
    resolve: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    }),
  } as unknown as RepositoryResolver;
}

describe('BaseRepository pessimistic locking guard', () => {
  it('throws for findOneForUpdate on a READ-role repository', async () => {
    const repository = new TestRepository(DatabaseRole.READ, fakeResolver());

    await expect(repository.callFindOneForUpdate()).rejects.toThrow(
      /requires an active transaction/,
    );
  });

  it('throws for findOneForUpdate on a WRITE-role repository outside a transaction', async () => {
    const repository = new TestRepository(DatabaseRole.WRITE, fakeResolver());

    await expect(repository.callFindOneForUpdate()).rejects.toThrow(
      /requires an active transaction/,
    );
  });

  it('throws for findOneForShare under the same conditions', async () => {
    const repository = new TestRepository(DatabaseRole.READ, fakeResolver());

    await expect(repository.callFindOneForShare()).rejects.toThrow(
      /requires an active transaction/,
    );
  });

  it('rejects rather than throwing synchronously when the guard fails', () => {
    const repository = new TestRepository(DatabaseRole.READ, fakeResolver());
    let result: Promise<unknown> | undefined;

    expect(() => {
      result = repository.callFindOneForUpdate();
    }).not.toThrow();

    return expect(result).rejects.toThrow(/requires an active transaction/);
  });

  it('succeeds for a WRITE-role repository inside an active transaction', async () => {
    const queryBuilder = fakeQueryBuilder();
    const repository = new TestRepository(
      DatabaseRole.WRITE,
      fakeResolver(queryBuilder),
    );
    const manager = {} as EntityManager;

    const result = await transactionContext.run(manager, () =>
      repository.callFindOneForUpdate(),
    );

    expect(result).toEqual({ id: 1 });
    expect(queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
  });
});

function connectivityError(): Error {
  return Object.assign(new Error('connection lost'), {
    code: 'ECONNRESET',
  });
}

describe('BaseRepository retry-on-connectivity-error', () => {
  it('retries and recovers when no explicit manager was supplied', async () => {
    const repositoryStub = {
      find: jest
        .fn()
        .mockRejectedValueOnce(connectivityError())
        .mockResolvedValueOnce(['recovered']),
    };
    const resolver = {
      resolve: jest.fn().mockReturnValue(repositoryStub),
      peekReadState: jest.fn().mockReturnValue(undefined),
      reportFailure: jest.fn(),
      waitForRecovery: jest.fn().mockResolvedValue(true),
    } as unknown as RepositoryResolver;

    const repository = new TestRepository(DatabaseRole.READ, resolver);

    await expect(repository.find({})).resolves.toEqual(['recovered']);
    expect(resolver.waitForRecovery).toHaveBeenCalledTimes(1);
    expect(repositoryStub.find).toHaveBeenCalledTimes(2);
  });

  it('reports failure and awaits recovery against the exact reader state pinned for this attempt, not one re-selected afterward', async () => {
    const readerA = { name: 'reader-a' } as unknown as DataSourceState;
    const readerB = { name: 'reader-b' } as unknown as DataSourceState;
    const repositoryStub = {
      find: jest
        .fn()
        .mockRejectedValueOnce(connectivityError())
        .mockResolvedValueOnce(['recovered']),
    };
    // Simulates round-robin having moved on to a different reader by the
    // time recovery is attempted — the pin must still target readerA.
    const peekReadState = jest
      .fn()
      .mockReturnValueOnce(readerA)
      .mockReturnValueOnce(readerB);
    const resolver = {
      resolve: jest.fn().mockReturnValue(repositoryStub),
      peekReadState,
      withPinnedState: jest.fn((_state, fn: () => unknown) => fn()),
      reportFailure: jest.fn(),
      waitForRecovery: jest.fn().mockResolvedValue(true),
    } as unknown as RepositoryResolver;

    const repository = new TestRepository(DatabaseRole.READ, resolver);

    await expect(repository.find({})).resolves.toEqual(['recovered']);

    expect(resolver.reportFailure).toHaveBeenCalledWith(
      DatabaseRole.READ,
      expect.any(Error),
      readerA,
    );
    expect(resolver.waitForRecovery).toHaveBeenCalledWith(
      DatabaseRole.READ,
      undefined,
      readerA,
    );
    expect(resolver.withPinnedState).toHaveBeenNthCalledWith(
      1,
      readerA,
      expect.any(Function),
    );
    expect(resolver.withPinnedState).toHaveBeenNthCalledWith(
      2,
      readerB,
      expect.any(Function),
    );
  });

  it('does not retry when an explicit manager was supplied, since the same stale manager would just fail again', async () => {
    const failingRepository = {
      find: jest.fn().mockRejectedValue(connectivityError()),
    };
    const explicitManager = {
      getRepository: jest.fn().mockReturnValue(failingRepository),
    } as unknown as EntityManager;
    const resolver = {
      resolve: jest.fn(),
      reportFailure: jest.fn(),
      waitForRecovery: jest.fn().mockResolvedValue(true),
    } as unknown as RepositoryResolver;

    const repository = new TestRepository(DatabaseRole.READ, resolver);

    await expect(repository.find({}, explicitManager)).rejects.toThrow(
      /explicitly supplied EntityManager/,
    );

    expect(resolver.waitForRecovery).not.toHaveBeenCalled();
    expect(resolver.reportFailure).toHaveBeenCalledWith(
      DatabaseRole.READ,
      expect.any(Error),
    );
    expect(failingRepository.find).toHaveBeenCalledTimes(1);
  });

  it('still surfaces the write-specific message for write operations regardless of an explicit manager', async () => {
    const failingRepository = {
      save: jest.fn().mockRejectedValue(connectivityError()),
    };
    const explicitManager = {
      getRepository: jest.fn().mockReturnValue(failingRepository),
    } as unknown as EntityManager;
    const resolver = {
      reportFailure: jest.fn(),
      waitForRecovery: jest.fn(),
    } as unknown as RepositoryResolver;

    const repository = new TestRepository(DatabaseRole.WRITE, resolver);

    await expect(repository.save({ id: 1 }, explicitManager)).rejects.toThrow(
      /may or may not have been committed/,
    );

    expect(resolver.waitForRecovery).not.toHaveBeenCalled();
  });

  it('does not retry a read call made on a WRITE-role repository inside an active transaction, since it resolves to the same dead transactional manager', async () => {
    const failingRepository = {
      find: jest.fn().mockRejectedValue(connectivityError()),
    };
    const resolver = {
      resolve: jest.fn().mockReturnValue(failingRepository),
      peekReadState: jest.fn().mockReturnValue(undefined),
      reportFailure: jest.fn(),
      waitForRecovery: jest.fn().mockResolvedValue(true),
    } as unknown as RepositoryResolver;

    const repository = new TestRepository(DatabaseRole.WRITE, resolver);
    const manager = {} as unknown as EntityManager;

    const result = transactionContext.run(manager, () => repository.find({}));

    await expect(result).rejects.toThrow(/active transaction was in progress/);

    expect(resolver.waitForRecovery).not.toHaveBeenCalled();
    expect(failingRepository.find).toHaveBeenCalledTimes(1);
  });
});
