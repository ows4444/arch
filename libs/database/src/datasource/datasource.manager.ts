import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
  DataSource,
} from 'typeorm';
import { DatabaseRole } from '../constants/database-role.enum';
import { DEFAULT_RETRY_OPTIONS } from '../constants/database.constants';
import { DATABASE_MODULE_OPTIONS } from '../constants/database.tokens';
import { DatabaseConnectionOptions } from '../interfaces/database-connection-options.interface';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';
import {
  DataSourceState,
  DataSourceStatus,
} from '../interfaces/datasource-state';
import { retry } from '../utils/retry.util';
import { DataSourceFactory } from './datasource.factory';

@Injectable()
export class DataSourceManager implements OnApplicationShutdown {
  private initializePromise: Promise<void> | undefined;

  private readonly logger = new Logger(DataSourceManager.name);

  private readonly writer: DataSourceState;

  private readonly readers: DataSourceState[];

  private initialized = false;

  private shuttingDown = false;

  private nextReaderIndex = 0;

  private readerFallbackCount = 0;

  constructor(
    @Inject(DATABASE_MODULE_OPTIONS)
    private readonly options: ResolvedDatabaseOptions,
    private readonly factory: DataSourceFactory,
  ) {
    this.writer = this.createState(options.writer, true);

    this.readers = (options.readers ?? []).map((config, index) =>
      this.createState(config, false, index),
    );
  }

  updateHealth(
    state: DataSourceState,
    result: {
      healthy: boolean;
      latencyMs?: number;
    },
  ): void {
    state.metrics.lastHealthCheckAt = new Date();
    const previouslyHealthy = state.healthy;

    if (result.healthy) {
      state.healthy = true;

      // Don't stomp a RECONNECTING status back to READY: a successful
      // health-check query can complete right after this same check cycle's
      // updateServerIdentity() call detected a server-identity change and
      // kicked off a background reconnectState() (see updateServerIdentity's
      // doc comment) that synchronously set status to RECONNECTING before
      // its first await. Overwriting that here would make selectReader()
      // treat this state as eligible again while its dataSource is still
      // being torn down/recreated underneath it. performReconnect's own
      // markConnected() call sets status back to READY once the reconnect
      // actually finishes.
      if (state.status !== DataSourceStatus.RECONNECTING) {
        state.status = DataSourceStatus.READY;
      }

      state.metrics.latencyMs = result.latencyMs;
      state.metrics.consecutiveHealthCheckFailures = 0;

      if (!previouslyHealthy) {
        void this.options.lifecycle?.onHealthChanged?.({
          ...state,
          metrics: { ...state.metrics },
        });
      }

      return;
    }

    state.healthy = false;

    if (state.status === DataSourceStatus.READY) {
      state.status = DataSourceStatus.DEGRADED;
    }

    state.metrics.healthCheckFailures++;
    state.metrics.consecutiveHealthCheckFailures++;

    if (previouslyHealthy) {
      void this.options.lifecycle?.onHealthChanged?.({
        ...state,
        metrics: { ...state.metrics },
      });
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.doInitialize();

    try {
      await this.initializePromise;
      this.initialized = true;
    } finally {
      this.initializePromise = undefined;
    }
  }

  private async doInitialize(): Promise<void> {
    this.logger.log('Initializing writer...');
    await this.ensureConnected(this.writer);

    this.logger.log(`Initializing ${this.readers.length} reader(s)...`);

    await Promise.all(
      this.readers.map((reader) => this.ensureConnected(reader)),
    );

    this.logger.log('Database initialized.');
  }

  private async waitForHealthy(
    state: DataSourceState,
    maxWaitMs = 2000,
  ): Promise<void> {
    const start = Date.now();

    while (!state.healthy && Date.now() - start < maxWaitMs) {
      if (state.reconnectPromise) {
        await Promise.race([
          state.reconnectPromise,
          new Promise((resolve) => setTimeout(resolve, 100)),
        ]);
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }

  async waitForRecovery(
    role: DatabaseRole,
    maxWaitMs?: number,
  ): Promise<boolean> {
    return this.waitForRecoveryForState(this.getState(role), maxWaitMs);
  }

  async waitForRecoveryForState(
    state: DataSourceState,
    maxWaitMs?: number,
  ): Promise<boolean> {
    await this.waitForHealthy(
      state,
      maxWaitMs ??
        this.options.retry?.readRecoveryTimeoutMs ??
        DEFAULT_RETRY_OPTIONS.readRecoveryTimeoutMs,
    );
    return state.healthy;
  }

  manager(role: DatabaseRole): EntityManager {
    return this.managerForState(this.getState(role));
  }

  managerForState(state: DataSourceState): EntityManager {
    if (!state.dataSource?.isInitialized || !state.healthy) {
      throw new ServiceUnavailableException(
        `Datasource '${state.name}' is not available.`,
      );
    }

    return state.dataSource.manager;
  }

  dataSource(role: DatabaseRole): DataSource {
    const state = this.getState(role);

    if (!state.dataSource?.isInitialized || !state.healthy) {
      throw new ServiceUnavailableException(
        `Datasource '${state.name}' is not available.`,
      );
    }

    return state.dataSource;
  }

  reportFailure(role: DatabaseRole, error: Error): void {
    this.reportFailureForState(this.getState(role), error);
  }

  reportFailureForState(state: DataSourceState, error: Error): void {
    this.updateHealth(state, { healthy: false });

    this.logger.error(
      `Datasource '${state.name}' reported a failure: ${error instanceof Error ? error.stack : error}`,
    );

    void this.reconnectState(state).catch((reconnectError: unknown) => {
      this.logger.error(
        `Datasource '${state.name}' reconnect (triggered by query failure) failed.`,
        reconnectError instanceof Error ? reconnectError.stack : undefined,
      );
    });
  }

  repository<TEntity extends ObjectLiteral>(
    entity: EntityTarget<TEntity>,
    role: DatabaseRole,
  ): Repository<TEntity> {
    return this.manager(role).getRepository(entity);
  }

  repositoryForState<TEntity extends ObjectLiteral>(
    entity: EntityTarget<TEntity>,
    state: DataSourceState,
  ): Repository<TEntity> {
    return this.managerForState(state).getRepository(entity);
  }

  /**
   * Selects (via the same round-robin as a normal read) and returns the
   * concrete reader state a caller is about to use, so it can be threaded
   * back into `reportFailureForState`/`waitForRecoveryForState` afterward
   * instead of those independently re-selecting — see `readPinContext`.
   * Returns `undefined` for WRITE, which always targets a single writer
   * deterministically and therefore never needs pinning.
   */
  peekReadState(role: DatabaseRole): DataSourceState | undefined {
    if (role !== DatabaseRole.READ) {
      return undefined;
    }

    return this.getState(role);
  }

  async reconnect(role: DatabaseRole): Promise<void> {
    const state = this.getState(role);

    await this.reconnectState(state);
  }

  writerState(): DataSourceState {
    return this.writer;
  }

  readerState(): Readonly<DataSourceState> | undefined {
    return this.readers[0];
  }

  readerStates(): readonly DataSourceState[] {
    return this.readers;
  }

  states(): readonly Readonly<DataSourceState>[] {
    return [this.writer, ...this.readers].map((state) => ({
      ...state,
      configuration: this.redact(state.configuration),
      metrics: {
        ...state.metrics,
      },
    }));
  }

  state(role: DatabaseRole): Readonly<DataSourceState> {
    const state =
      role === DatabaseRole.WRITE
        ? this.writer
        : (this.readers[0] ?? this.writer);

    return {
      ...state,
      configuration: this.redact(state.configuration),
      metrics: {
        ...state.metrics,
      },
    };
  }

  private redact(
    configuration: DataSourceState['configuration'],
  ): DataSourceState['configuration'] {
    return {
      ...configuration,
      password: '***REDACTED***',
    };
  }

  async reconnectStateByReference(state: DataSourceState): Promise<void> {
    await this.reconnectState(state);
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.destroy(this.writer);

    await Promise.allSettled(
      this.readers.map((reader) => this.destroy(reader)),
    );
  }

  getReaderFallbackCount(): number {
    return this.readerFallbackCount;
  }

  private selectReader(): DataSourceState {
    if (this.readers.length === 0) {
      return this.writer;
    }

    for (let i = 0; i < this.readers.length; i++) {
      const index = (this.nextReaderIndex + i) % this.readers.length;
      const candidate = this.readers[index];
      if (!candidate) {
        continue;
      }

      if (candidate.healthy && candidate.status === DataSourceStatus.READY) {
        this.nextReaderIndex = (index + 1) % this.readers.length;
        return candidate;
      }
    }

    this.readerFallbackCount++;
    this.logger.warn(
      `No healthy reader available; falling back to the writer for a read (fallback count: ${this.readerFallbackCount}).`,
    );

    return this.writer;
  }

  private getState(role: DatabaseRole): DataSourceState {
    if (role === DatabaseRole.WRITE) {
      return this.writer;
    }

    if (this.readers.length === 0) {
      return this.writer;
    }

    return this.selectReader();
  }

  private createState(
    options: DatabaseConnectionOptions,
    isWriter: boolean,
    index = 0,
  ): DataSourceState {
    const name = options.name ?? (isWriter ? 'writer' : `reader-${index + 1}`);
    return {
      name,

      configuration: { ...options, name },

      isWriter,

      status: DataSourceStatus.STOPPED,

      healthy: false,

      dataSource: undefined,

      reconnectPromise: undefined,

      metrics: {
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
      },
    };
  }

  private retryOptions(): {
    maxAttempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
  } {
    return {
      maxAttempts:
        this.options.retry?.maxAttempts ?? DEFAULT_RETRY_OPTIONS.maxAttempts,

      initialDelayMs:
        this.options.retry?.initialDelayMs ??
        DEFAULT_RETRY_OPTIONS.initialDelayMs,

      maxDelayMs:
        this.options.retry?.maxDelayMs ?? DEFAULT_RETRY_OPTIONS.maxDelayMs,
    };
  }

  private async ensureConnected(state: DataSourceState): Promise<void> {
    if (state.dataSource?.isInitialized) {
      return;
    }

    if (state.reconnectPromise) {
      await state.reconnectPromise;

      return;
    }

    state.reconnectPromise = this.connect(state);

    try {
      await state.reconnectPromise;
    } finally {
      state.reconnectPromise = undefined;
    }
  }

  private async connect(state: DataSourceState): Promise<void> {
    this.logger.log(`Connecting datasource '${state.name}'...`);
    state.status = DataSourceStatus.INITIALIZING;

    try {
      state.dataSource = await retry(
        () => this.factory.create(state.configuration),
        this.retryOptions(),
      );

      this.markConnected(state);
      this.recordSuccessfulConnection(state);
    } catch (error) {
      this.markFailed(state, error);

      throw error;
    }
  }

  private async reconnectState(state: DataSourceState): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    if (state.reconnectPromise) {
      await state.reconnectPromise;

      return;
    }

    const lastAttempt = state.metrics.lastReconnectAttemptAt;

    if (lastAttempt) {
      const elapsed = Date.now() - lastAttempt.getTime();

      if (elapsed < this.reconnectCooldown()) {
        return;
      }
    }

    state.metrics.lastReconnectAttemptAt = new Date();

    state.reconnectPromise = this.performReconnect(state);

    try {
      await state.reconnectPromise;
    } finally {
      state.reconnectPromise = undefined;
    }
  }

  private reconnectCooldown(): number {
    return (
      this.options.retry?.reconnectCooldownMs ??
      DEFAULT_RETRY_OPTIONS.reconnectCooldownMs
    );
  }

  private markConnected(state: DataSourceState): void {
    state.status = DataSourceStatus.READY;
    state.healthy = true;
    state.metrics.lastConnectedAt = new Date();
    state.metrics.lastError = undefined;
    state.metrics.consecutiveHealthCheckFailures = 0;

    void this.options.lifecycle?.onConnected?.({
      ...state,
      metrics: { ...state.metrics },
    });
  }

  private markFailed(state: DataSourceState, error: unknown): void {
    state.status = DataSourceStatus.FAILED;
    state.healthy = false;
    state.metrics.failedConnections++;
    state.metrics.lastFailureAt = new Date();
    state.metrics.lastError =
      error instanceof Error ? error : new Error(String(error));
  }

  /**
   * A `serverUuid` change means the TCP endpoint now answers as a genuinely
   * different MySQL server (e.g. a failover promoted a new instance behind
   * the same host/DNS name) — the pool must reconnect to pick up the new
   * server's actual state. A `readOnly` flip alone does NOT reconnect: the
   * existing connection to the same server is still perfectly valid, only
   * that server's writer/reader role changed. This lib's writer/reader
   * assignment is fixed at config time and is not auto-remapped from a role
   * flip, so it's only logged/recorded here for observability/alerting.
   */
  updateServerIdentity(
    state: DataSourceState,
    identity: {
      serverUuid: string;
      hostname: string;
      readOnly: boolean;
    },
  ): void {
    const previousServerUuid = state.metrics.serverUuid;
    const previousReadOnly = state.metrics.readOnly;

    const serverChanged =
      previousServerUuid !== undefined &&
      previousServerUuid !== identity.serverUuid;

    const roleChanged =
      previousReadOnly !== undefined && previousReadOnly !== identity.readOnly;

    state.metrics.serverUuid = identity.serverUuid;
    state.metrics.hostname = identity.hostname;
    state.metrics.readOnly = identity.readOnly;

    if (serverChanged) {
      this.logger.warn(
        `Datasource '${state.name}' switched MySQL server (${previousServerUuid} -> ${identity.serverUuid}).`,
      );

      state.metrics.lastServerChangeAt = new Date();

      void this.reconnectState(state).catch((error) =>
        this.logger.error(
          `Failed to recreate datasource after server switch.`,
          error instanceof Error ? error.stack : undefined,
        ),
      );
    }

    if (roleChanged) {
      this.logger.warn(
        `Datasource '${state.name}' role changed (${previousReadOnly ? 'REPLICA' : 'PRIMARY'} -> ${identity.readOnly ? 'REPLICA' : 'PRIMARY'}).`,
      );

      state.metrics.lastRoleChangeAt = new Date();
    }
  }

  private recordSuccessfulConnection(state: DataSourceState): void {
    state.metrics.successfulConnections++;
  }

  private async performReconnect(state: DataSourceState): Promise<void> {
    this.logger.warn(`Reconnecting datasource '${state.name}'.`);

    state.metrics.reconnectCount++;

    const previous = state.dataSource;

    state.status = DataSourceStatus.RECONNECTING;

    try {
      state.dataSource = await retry(
        () => this.factory.recreate(previous, state.configuration),
        this.retryOptions(),
      );

      this.markConnected(state);

      void this.options.lifecycle?.onReconnect?.({
        ...state,
        metrics: { ...state.metrics },
      });

      this.logger.log(
        `Datasource '${state.name}' reconnected successfully (attempt ${state.metrics.reconnectCount}).`,
      );
    } catch (error) {
      this.markFailed(state, error);

      throw error;
    }
  }

  private async destroy(state: DataSourceState): Promise<void> {
    state.status = DataSourceStatus.SHUTTING_DOWN;

    try {
      await this.factory.destroy(state.dataSource);
    } catch (error) {
      this.logger.error(
        `Failed to destroy datasource '${state.name}'.`,
        error instanceof Error ? error.stack : undefined,
      );
    }

    state.dataSource = undefined;
    state.healthy = false;

    state.status = DataSourceStatus.STOPPED;

    state.metrics.lastDisconnectedAt = new Date();

    void this.options.lifecycle?.onDisconnected?.({
      ...state,
      metrics: { ...state.metrics },
    });
  }
}
