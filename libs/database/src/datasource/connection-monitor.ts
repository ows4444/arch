import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import {
  DEFAULT_HEALTH_CHECK_INTERVAL_MS,
  DEFAULT_HEALTH_CHECK_QUERY,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
} from '../constants/database.constants';
import { DATABASE_MODULE_OPTIONS } from '../constants/database.tokens';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';
import type { MysqlServerIdentity } from '../interfaces/mysql-server-identity.interface';
import { DataSourceManager } from './datasource.manager';

function toBooleanFlag(value: unknown): boolean {
  if (Buffer.isBuffer(value)) {
    return value.toString().trim() === '1';
  }
  return Number(value) === 1;
}

@Injectable()
export class ConnectionMonitor
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(ConnectionMonitor.name);

  private timer?: NodeJS.Timeout;

  private running = false;

  constructor(
    @Inject(DATABASE_MODULE_OPTIONS)
    private readonly options: ResolvedDatabaseOptions,
    private readonly manager: DataSourceManager,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.options.autoInitialize !== false) {
      await this.manager.initialize();
    }

    this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  private start(): void {
    if (this.timer) {
      return;
    }

    const interval =
      this.options.health?.intervalMs ?? DEFAULT_HEALTH_CHECK_INTERVAL_MS;

    void this.healthCheck().catch((error: unknown) => {
      this.logger.error(
        'Unexpected error while running initial database health check.',
        error instanceof Error ? error.stack : undefined,
      );
    });

    this.timer = setInterval(() => {
      void this.healthCheck().catch((error: unknown) => {
        this.logger.error(
          'Unexpected error while running database health checks.',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, interval);

    this.timer.unref();
  }

  private stop(): void {
    if (!this.timer) {
      return;
    }

    clearInterval(this.timer);

    this.timer = undefined;
  }

  private async healthCheck(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      await Promise.all([
        this.check(this.manager.writerState()),
        ...this.manager.readerStates().map((reader) => this.check(reader)),
      ]);
    } finally {
      this.running = false;
    }
  }

  private async check(
    state: ReturnType<DataSourceManager['writerState']>,
  ): Promise<void> {
    const query = this.options.health?.query ?? DEFAULT_HEALTH_CHECK_QUERY;

    const started = Date.now();

    try {
      if (!state.dataSource?.isInitialized) {
        throw new Error('Datasource not initialized.');
      }

      const timeout =
        this.options.health?.timeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;

      let timer: NodeJS.Timeout | undefined;

      let rows: MysqlServerIdentity[] = [];

      try {
        rows = (await Promise.race([
          state.dataSource.manager.query(query),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Health check timeout')),
              timeout,
            );
          }),
        ])) as MysqlServerIdentity[];
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }

      const identity = rows[0];

      if (!identity) {
        throw new Error('Health check returned no server identity.');
      }

      this.manager.updateServerIdentity(state, {
        serverUuid: identity['@@server_uuid'],
        hostname: identity['@@hostname'],
        readOnly: toBooleanFlag(identity['@@read_only']),
      });

      const elapsed = Date.now() - started;

      this.manager.updateHealth(state, {
        healthy: true,
        latencyMs: elapsed,
      });
    } catch (error) {
      this.logger.warn(
        `Datasource '${state.name}' health check failed: ${error instanceof Error ? error.stack : error}`,
      );

      this.manager.updateHealth(state, {
        healthy: false,
      });

      if (state.metrics.consecutiveHealthCheckFailures < 3) {
        return;
      }

      try {
        await this.manager.reconnectStateByReference(state);
      } catch (reconnectError) {
        this.logger.error(
          `Datasource '${state.name}' reconnect failed.`,
          reconnectError instanceof Error ? reconnectError.stack : undefined,
        );
      }
    }
  }
}
