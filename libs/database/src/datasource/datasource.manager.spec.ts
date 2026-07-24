import { DataSourceManager } from './datasource.manager';
import { DataSourceFactory } from './datasource.factory';
import { DatabaseRole } from '../constants/database-role.enum';
import { DataSourceStatus } from '../interfaces/datasource-state';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';

function options(
  readerCount: number,
  overrides: Partial<ResolvedDatabaseOptions> = {},
): ResolvedDatabaseOptions {
  return {
    writer: {
      host: 'writer',
      username: 'u',
      password: 'p',
      database: 'd',
      port: 3306,
    },
    readers: Array.from({ length: readerCount }, (_, index) => ({
      host: `reader-${index + 1}`,
      username: 'u',
      password: 'p',
      database: 'd',
      port: 3306,
    })),
    ...overrides,
  };
}

function fakeFactory(
  overrides: Partial<DataSourceFactory> = {},
): DataSourceFactory {
  return {
    create: jest.fn().mockResolvedValue({ isInitialized: true }),
    destroy: jest.fn().mockResolvedValue(undefined),
    recreate: jest.fn().mockResolvedValue({ isInitialized: true }),
    ...overrides,
  } as unknown as DataSourceFactory;
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('DataSourceManager reader fallback observability', () => {
  it('starts at zero', () => {
    const manager = new DataSourceManager(options(1), {} as DataSourceFactory);

    expect(manager.getReaderFallbackCount()).toBe(0);
  });

  it('increments when no reader is healthy and a read falls back to the writer', () => {
    const manager = new DataSourceManager(options(1), {} as DataSourceFactory);

    expect(() => manager.dataSource(DatabaseRole.READ)).toThrow();

    expect(manager.getReaderFallbackCount()).toBe(1);
  });

  it('does not increment when there are no readers configured at all', () => {
    const manager = new DataSourceManager(options(0), {} as DataSourceFactory);

    expect(() => manager.dataSource(DatabaseRole.READ)).toThrow();

    expect(manager.getReaderFallbackCount()).toBe(0);
  });
});

describe('DataSourceManager.initialize', () => {
  it('connects the writer and all readers, becoming healthy', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(2), factory);

    await manager.initialize();

    expect(factory.create).toHaveBeenCalledTimes(3);
    expect(manager.state(DatabaseRole.WRITE).healthy).toBe(true);
    expect(manager.dataSource(DatabaseRole.WRITE)).toBeDefined();
  });

  it('shares a single in-flight initialization across concurrent callers', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(0), factory);

    await Promise.all([manager.initialize(), manager.initialize()]);

    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it('is a no-op once already initialized', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(0), factory);

    await manager.initialize();
    await manager.initialize();

    expect(factory.create).toHaveBeenCalledTimes(1);
  });

  it('propagates a writer connection failure and leaves the manager uninitialized', async () => {
    const error = new Error('connect failed');
    const factory = fakeFactory({ create: jest.fn().mockRejectedValue(error) });
    const manager = new DataSourceManager(
      options(0, {
        retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 1 },
      }),
      factory,
    );

    await expect(manager.initialize()).rejects.toThrow('connect failed');
    expect(manager.state(DatabaseRole.WRITE).healthy).toBe(false);
  });
});

describe('DataSourceManager reconnect', () => {
  it('reconnects a failed writer and becomes healthy again', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(0), factory);
    await manager.initialize();

    await manager.reconnect(DatabaseRole.WRITE);

    expect(factory.recreate).toHaveBeenCalledTimes(1);
    expect(manager.state(DatabaseRole.WRITE).healthy).toBe(true);
    expect(manager.state(DatabaseRole.WRITE).metrics.reconnectCount).toBe(1);
  });

  it('respects the reconnect cooldown: a second immediate reconnect is skipped', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(
      options(0, { retry: { reconnectCooldownMs: 60_000 } }),
      factory,
    );
    await manager.initialize();

    await manager.reconnect(DatabaseRole.WRITE);
    await manager.reconnect(DatabaseRole.WRITE);

    expect(factory.recreate).toHaveBeenCalledTimes(1);
  });

  it('reportFailure marks the datasource unhealthy and triggers a reconnect attempt', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(0), factory);
    await manager.initialize();

    manager.reportFailure(DatabaseRole.WRITE, new Error('connection reset'));

    expect(manager.state(DatabaseRole.WRITE).healthy).toBe(false);

    await flushMicrotasks();
    await flushMicrotasks();

    expect(factory.recreate).toHaveBeenCalledTimes(1);
  });

  it('does not attempt to reconnect after the manager has started shutting down', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(0), factory);
    await manager.initialize();

    await manager.onApplicationShutdown();

    manager.reportFailure(DatabaseRole.WRITE, new Error('connection reset'));
    await flushMicrotasks();
    await flushMicrotasks();

    expect(factory.recreate).not.toHaveBeenCalled();
  });

  it('does not let a health check that races a server-switch reconnect mark the state READY again', async () => {
    // `recreate` never resolves, simulating an in-flight reconnect so we can
    // inspect `status` mid-flight rather than after it completes.
    const factory = fakeFactory({
      recreate: jest.fn(() => new Promise(() => undefined)),
    });
    const manager = new DataSourceManager(options(0), factory);
    await manager.initialize();

    const writer = manager.writerState();

    // Establish an initial server identity so the next call can detect a change.
    manager.updateServerIdentity(writer, {
      serverUuid: 'server-a',
      hostname: 'host-a',
      readOnly: false,
    });

    // Simulates ConnectionMonitor.check()'s exact call order: updateServerIdentity
    // (detects the switch, synchronously kicks off a background reconnect that sets
    // status to RECONNECTING) followed immediately by updateHealth(healthy: true)
    // for the same successful health-check query that revealed the switch.
    manager.updateServerIdentity(writer, {
      serverUuid: 'server-b',
      hostname: 'host-b',
      readOnly: false,
    });
    manager.updateHealth(writer, { healthy: true, latencyMs: 5 });

    expect(writer.status).toBe(DataSourceStatus.RECONNECTING);
    expect(factory.recreate).toHaveBeenCalledTimes(1);
  });
});

describe('DataSourceManager.onApplicationShutdown', () => {
  it('destroys the writer and all readers', async () => {
    const factory = fakeFactory();
    const manager = new DataSourceManager(options(2), factory);
    await manager.initialize();

    await manager.onApplicationShutdown();

    expect(factory.destroy).toHaveBeenCalledTimes(3);
  });

  it('destroys the remaining readers even if one fails to destroy', async () => {
    const factory = fakeFactory({
      destroy: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('destroy failed'))
        .mockResolvedValueOnce(undefined),
    });
    const manager = new DataSourceManager(options(2), factory);
    await manager.initialize();

    await expect(manager.onApplicationShutdown()).resolves.toBeUndefined();

    expect(factory.destroy).toHaveBeenCalledTimes(3);
  });
});
