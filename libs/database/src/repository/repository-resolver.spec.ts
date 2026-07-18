import type { EntityManager } from 'typeorm';
import { DatabaseRole } from '../constants/database-role.enum';
import { transactionContext } from '../transaction';
import { readPinContext } from '../datasource/read-pin.context';
import type { DataSourceState } from '../interfaces/datasource-state';
import { RepositoryResolver } from './repository-resolver';

function fakeState(name: string): DataSourceState {
  return { name } as DataSourceState;
}

function setup() {
  const dataSourceManager = {
    repository: jest.fn(),
    repositoryForState: jest.fn(),
    manager: jest.fn(),
    managerForState: jest.fn(),
    dataSource: jest.fn(),
    peekReadState: jest.fn(),
    reportFailure: jest.fn(),
    reportFailureForState: jest.fn(),
    waitForRecovery: jest.fn().mockResolvedValue(true),
    waitForRecoveryForState: jest.fn().mockResolvedValue(true),
  };

  const resolver = new RepositoryResolver(dataSourceManager as never);

  return { resolver, dataSourceManager };
}

describe('RepositoryResolver.resolve', () => {
  it('resolves a repository from the active write transaction manager, not the datasource manager', async () => {
    const { resolver, dataSourceManager } = setup();
    const txManager = {
      getRepository: jest.fn().mockReturnValue('tx-repo'),
    } as unknown as EntityManager;

    const result = await transactionContext.run(txManager, () =>
      Promise.resolve(resolver.resolve('Entity', DatabaseRole.WRITE)),
    );

    expect(result).toBe('tx-repo');
    expect(dataSourceManager.repository).not.toHaveBeenCalled();
  });

  it('resolves a repository from the pinned read state when one is set', async () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');
    dataSourceManager.repositoryForState.mockReturnValue('pinned-repo');

    const result = await readPinContext.run(state, () =>
      Promise.resolve(resolver.resolve('Entity', DatabaseRole.READ)),
    );

    expect(result).toBe('pinned-repo');
    expect(dataSourceManager.repositoryForState).toHaveBeenCalledWith(
      'Entity',
      state,
    );
  });

  it('falls back to the datasource manager when there is no active transaction or pin', () => {
    const { resolver, dataSourceManager } = setup();
    dataSourceManager.repository.mockReturnValue('default-repo');

    const result = resolver.resolve('Entity', DatabaseRole.WRITE);

    expect(result).toBe('default-repo');
    expect(dataSourceManager.repository).toHaveBeenCalledWith(
      'Entity',
      DatabaseRole.WRITE,
    );
  });

  it('does not use a read pin for a WRITE resolve', async () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');
    dataSourceManager.repository.mockReturnValue('default-repo');

    const result = await readPinContext.run(state, () =>
      Promise.resolve(resolver.resolve('Entity', DatabaseRole.WRITE)),
    );

    expect(result).toBe('default-repo');
    expect(dataSourceManager.repositoryForState).not.toHaveBeenCalled();
  });
});

describe('RepositoryResolver.manager', () => {
  it('returns the active write transaction manager', async () => {
    const { resolver } = setup();
    const txManager = {} as EntityManager;

    const result = await transactionContext.run(txManager, () =>
      Promise.resolve(resolver.manager(DatabaseRole.WRITE)),
    );

    expect(result).toBe(txManager);
  });

  it('returns the manager for the pinned read state when one is set', async () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');
    const pinnedManager = {} as EntityManager;
    dataSourceManager.managerForState.mockReturnValue(pinnedManager);

    const result = await readPinContext.run(state, () =>
      Promise.resolve(resolver.manager(DatabaseRole.READ)),
    );

    expect(result).toBe(pinnedManager);
    expect(dataSourceManager.managerForState).toHaveBeenCalledWith(state);
  });

  it('falls back to the datasource manager otherwise', () => {
    const { resolver, dataSourceManager } = setup();
    const defaultManager = {} as EntityManager;
    dataSourceManager.manager.mockReturnValue(defaultManager);

    const result = resolver.manager(DatabaseRole.READ);

    expect(result).toBe(defaultManager);
    expect(dataSourceManager.manager).toHaveBeenCalledWith(DatabaseRole.READ);
  });
});

describe('RepositoryResolver.dataSource', () => {
  it('delegates to the datasource manager', () => {
    const { resolver, dataSourceManager } = setup();
    dataSourceManager.dataSource.mockReturnValue('the-datasource');

    expect(resolver.dataSource(DatabaseRole.WRITE)).toBe('the-datasource');
    expect(dataSourceManager.dataSource).toHaveBeenCalledWith(
      DatabaseRole.WRITE,
    );
  });
});

describe('RepositoryResolver.peekReadState / withPinnedState', () => {
  it('peekReadState delegates to the datasource manager', () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');
    dataSourceManager.peekReadState.mockReturnValue(state);

    expect(resolver.peekReadState(DatabaseRole.READ)).toBe(state);
  });

  it('withPinnedState makes the state visible to code run inside it', async () => {
    const { resolver } = setup();
    const state = fakeState('reader-1');

    const seen = await resolver.withPinnedState(state, () =>
      Promise.resolve(readPinContext.current),
    );

    expect(seen).toBe(state);
    expect(readPinContext.current).toBeUndefined();
  });
});

describe('RepositoryResolver.reportFailure', () => {
  it('reports against the pinned state when one is provided', () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');
    const error = new Error('boom');

    resolver.reportFailure(DatabaseRole.READ, error, state);

    expect(dataSourceManager.reportFailureForState).toHaveBeenCalledWith(
      state,
      error,
    );
    expect(dataSourceManager.reportFailure).not.toHaveBeenCalled();
  });

  it('reports against the role when no state is provided', () => {
    const { resolver, dataSourceManager } = setup();
    const error = new Error('boom');

    resolver.reportFailure(DatabaseRole.WRITE, error);

    expect(dataSourceManager.reportFailure).toHaveBeenCalledWith(
      DatabaseRole.WRITE,
      error,
    );
  });
});

describe('RepositoryResolver.waitForRecovery', () => {
  it('waits against the pinned state when one is provided', async () => {
    const { resolver, dataSourceManager } = setup();
    const state = fakeState('reader-1');

    await expect(
      resolver.waitForRecovery(DatabaseRole.READ, 500, state),
    ).resolves.toBe(true);
    expect(dataSourceManager.waitForRecoveryForState).toHaveBeenCalledWith(
      state,
      500,
    );
  });

  it('waits against the role when no state is provided', async () => {
    const { resolver, dataSourceManager } = setup();

    await expect(
      resolver.waitForRecovery(DatabaseRole.WRITE, 500),
    ).resolves.toBe(true);
    expect(dataSourceManager.waitForRecovery).toHaveBeenCalledWith(
      DatabaseRole.WRITE,
      500,
    );
  });
});

describe('RepositoryResolver.scoped', () => {
  it('constructs the repository with the given role and this resolver', () => {
    const { resolver } = setup();
    const manager = {} as EntityManager;

    class FakeRepository {
      constructor(
        public role: DatabaseRole,
        public resolver: RepositoryResolver,
      ) {}
    }

    const instance = resolver.scoped(
      FakeRepository,
      DatabaseRole.READ,
      manager,
    );

    expect(instance.role).toBe(DatabaseRole.READ);
    expect(instance.resolver).toBe(resolver);
  });

  it('sets a non-enumerable, read-only managerOverride on the instance', () => {
    const { resolver } = setup();
    const manager = { getRepository: jest.fn() } as unknown as EntityManager;

    class FakeRepository {
      managerOverride?: EntityManager;
    }

    const instance = resolver.scoped(
      FakeRepository,
      DatabaseRole.WRITE,
      manager,
    );

    expect(instance.managerOverride).toBe(manager);
    expect(Object.keys(instance)).not.toContain('managerOverride');
    expect(() => {
      (instance as { managerOverride?: unknown }).managerOverride = undefined;
    }).toThrow();
  });
});
