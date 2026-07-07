import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

export const DEFAULT_HEALTH_CHECK_QUERY =
  'SELECT @@server_uuid, @@hostname, @@read_only';

export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5_000;

export const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 15_000;

export const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export const DEFAULT_POOL_SIZE = 20;

export const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

export const DEFAULT_RETRY_OPTIONS = {
  maxAttempts: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  reconnectCooldownMs: 60_000,
} as const;

export const DEFAULT_MYSQL_OPTIONS: Partial<
  MysqlConnectionOptions | PostgresConnectionOptions
> = {
  type: 'mysql',
  synchronize: false,

  logging: false,

  migrationsRun: false,

  poolSize: DEFAULT_POOL_SIZE,

  extra: {
    waitForConnections: true,

    connectionLimit: DEFAULT_POOL_SIZE,

    queueLimit: 0,

    connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,

    enableKeepAlive: true,

    keepAliveInitialDelay: 0,

    idleTimeout: DEFAULT_IDLE_TIMEOUT_MS,
  },
};
