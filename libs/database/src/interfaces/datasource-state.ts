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

  lastReconnectAttemptAt?: Date;

  consecutiveHealthCheckFailures: number;

  healthCheckFailures: number;

  latencyMs?: number;

  successfulConnections: number;

  failedConnections: number;

  lastConnectedAt?: Date;

  lastDisconnectedAt?: Date;

  lastHealthCheckAt?: Date;

  lastFailureAt?: Date;

  lastError?: Error;

  serverUuid?: string;

  hostname?: string;

  readOnly?: boolean;

  lastServerChangeAt?: Date;

  lastRoleChangeAt?: Date;
}

export interface DataSourceState {
  readonly name: string;

  readonly isWriter: boolean;

  readonly configuration: DatabaseConnectionOptions;

  dataSource?: DataSource;

  status: DataSourceStatus;

  healthy: boolean;

  reconnectPromise?: Promise<void>;

  metrics: DataSourceMetrics;
}
