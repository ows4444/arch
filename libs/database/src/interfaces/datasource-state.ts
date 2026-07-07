import type { DataSource } from 'typeorm';
import { DatabaseConnectionOptions } from './database-connection-options.interface';

export enum DataSourceStatus {
  STOPPED = 'STOPPED',

  INITIALIZING = 'INITIALIZING',

  READY = 'READY',

  RECONNECTING = 'RECONNECTING',

  DEGRADED = 'DEGRADED',

  FAILED = 'FAILED',

  SHUTTING_DOWN = 'SHUTTING_DOWN',
}

export interface DataSourceMetrics {
  reconnectCount: number;

  lastReconnectAttemptAt: Date | undefined;

  consecutiveHealthCheckFailures: number;

  healthCheckFailures: number;

  latencyMs: number | undefined;

  successfulConnections: number;

  failedConnections: number;

  lastConnectedAt: Date | undefined;

  lastDisconnectedAt: Date | undefined;

  lastHealthCheckAt: Date | undefined;

  lastFailureAt: Date | undefined;

  lastError: Error | undefined;

  serverUuid: string | undefined;

  hostname: string | undefined;

  readOnly: boolean | undefined;

  lastServerChangeAt: Date | undefined;

  lastRoleChangeAt: Date | undefined;
}

export interface DataSourceState {
  readonly name: string;

  readonly isWriter: boolean;

  readonly configuration: DatabaseConnectionOptions;

  dataSource: DataSource | undefined;

  status: DataSourceStatus;

  healthy: boolean;

  reconnectPromise: Promise<void> | undefined;

  metrics: DataSourceMetrics;
}
