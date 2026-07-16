import { ConnectionMonitor } from './connection-monitor';
import { DataSourceManager } from './datasource.manager';
import {
  DataSourceMetrics,
  DataSourceState,
  DataSourceStatus,
} from '../interfaces/datasource-state';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';
import type { MysqlServerIdentity } from '../interfaces/mysql-server-identity.interface';

function fakeMetrics(
  overrides: Partial<DataSourceMetrics> = {},
): DataSourceMetrics {
  return {
    healthCheckFailures: 0,
    reconnectCount: 0,
    successfulConnections: 0,
    consecutiveHealthCheckFailures: 0,
    failedConnections: 0,
    lastReconnectAttemptAt: undefined,
    latencyMs: undefined,
    lastConnectedAt: undefined,
    lastDisconnectedAt: undefined,
    lastHealthCheckAt: undefined,
    lastFailureAt: undefined,
    lastError: undefined,
    serverUuid: undefined,
    hostname: undefined,
    readOnly: undefined,
    lastServerChangeAt: undefined,
    lastRoleChangeAt: undefined,
    ...overrides,
  };
}

function fakeState(overrides: Partial<DataSourceState> = {}): DataSourceState {
  return {
    name: 'writer',
    isWriter: true,
    configuration: {
      host: 'h',
      username: 'u',
      password: 'p',
      database: 'd',
      port: 3306,
    },
    dataSource: {
      isInitialized: true,
      manager: { query: jest.fn().mockResolvedValue([]) },
    } as never,
    status: DataSourceStatus.READY,
    healthy: true,
    reconnectPromise: undefined,
    metrics: fakeMetrics(),
    ...overrides,
  };
}

function identity(overrides: Partial<MysqlServerIdentity> = {}) {
  return {
    '@@server_uuid': 'uuid-1',
    '@@hostname': 'host-1',
    '@@read_only': 0,
    ...overrides,
  };
}

function fakeManager(
  writerState: DataSourceState,
  overrides: Partial<DataSourceManager> = {},
): DataSourceManager {
  return {
    initialize: jest.fn().mockResolvedValue(undefined),
    writerState: jest.fn().mockReturnValue(writerState),
    readerStates: jest.fn().mockReturnValue([]),
    updateHealth: jest.fn(),
    updateServerIdentity: jest.fn(),
    reconnectStateByReference: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DataSourceManager;
}

function baseOptions(
  overrides: Partial<ResolvedDatabaseOptions> = {},
): ResolvedDatabaseOptions {
  return {
    writer: {
      host: 'h',
      username: 'u',
      password: 'p',
      database: 'd',
      port: 3306,
    },
    readers: [],
    ...overrides,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ConnectionMonitor', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  it('initializes the manager on bootstrap unless autoInitialize is false', async () => {
    const writer = fakeState();
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(baseOptions(), manager);

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();

    expect(manager.initialize).toHaveBeenCalledTimes(1);
    monitor.onApplicationShutdown();
  });

  it('does not initialize the manager when autoInitialize is false', async () => {
    const writer = fakeState();
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(
      baseOptions({ autoInitialize: false }),
      manager,
    );

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();

    expect(manager.initialize).not.toHaveBeenCalled();
    monitor.onApplicationShutdown();
  });

  it('marks the datasource healthy and records server identity on a successful check', async () => {
    const queryMock = jest.fn().mockResolvedValue([identity()]);
    const writer = fakeState({
      dataSource: {
        isInitialized: true,
        manager: { query: queryMock },
      } as never,
    });
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(baseOptions(), manager);

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(manager.updateHealth).toHaveBeenCalledWith(
      writer,
      expect.objectContaining({ healthy: true }),
    );
    expect(manager.updateServerIdentity).toHaveBeenCalledWith(writer, {
      serverUuid: 'uuid-1',
      hostname: 'host-1',
      readOnly: false,
    });

    monitor.onApplicationShutdown();
  });

  it('marks the datasource unhealthy when the query fails, without reconnecting before 3 consecutive failures', async () => {
    const queryMock = jest.fn().mockRejectedValue(new Error('query failed'));
    const writer = fakeState({
      dataSource: {
        isInitialized: true,
        manager: { query: queryMock },
      } as never,
      metrics: fakeMetrics({ consecutiveHealthCheckFailures: 1 }),
    });
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(baseOptions(), manager);

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(manager.updateHealth).toHaveBeenCalledWith(writer, {
      healthy: false,
    });
    expect(manager.reconnectStateByReference).not.toHaveBeenCalled();

    monitor.onApplicationShutdown();
  });

  it('triggers a reconnect once consecutive failures reach 3', async () => {
    const queryMock = jest.fn().mockRejectedValue(new Error('query failed'));
    const writer = fakeState({
      dataSource: {
        isInitialized: true,
        manager: { query: queryMock },
      } as never,
      metrics: fakeMetrics({ consecutiveHealthCheckFailures: 3 }),
    });
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(baseOptions(), manager);

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(manager.reconnectStateByReference).toHaveBeenCalledWith(writer);

    monitor.onApplicationShutdown();
  });

  it('treats an uninitialized datasource as unhealthy without querying it', async () => {
    const queryMock = jest.fn();
    const writer = fakeState({
      dataSource: {
        isInitialized: false,
        manager: { query: queryMock },
      } as never,
    });
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(baseOptions(), manager);

    await monitor.onApplicationBootstrap();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(queryMock).not.toHaveBeenCalled();
    expect(manager.updateHealth).toHaveBeenCalledWith(writer, {
      healthy: false,
    });

    monitor.onApplicationShutdown();
  });

  it('stops scheduling further checks after shutdown', async () => {
    jest.useFakeTimers();

    const writer = fakeState();
    const manager = fakeManager(writer);
    const monitor = new ConnectionMonitor(
      baseOptions({ health: { intervalMs: 1000 } }),
      manager,
    );

    await monitor.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(0);

    monitor.onApplicationShutdown();

    const callsAfterShutdown = (manager.updateHealth as jest.Mock).mock.calls
      .length;

    await jest.advanceTimersByTimeAsync(10_000);

    expect((manager.updateHealth as jest.Mock).mock.calls.length).toBe(
      callsAfterShutdown,
    );

    jest.useRealTimers();
  });
});
