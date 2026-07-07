import { DatabaseConnectionOptions } from './database-connection-options.interface';
import { DatabaseHealthOptions } from './database-health-options.interface';
import { DatabaseLifecycleHooks } from './database-module-options';
import { DatabaseRetryOptions } from './database-retry-options.interface';

export interface ResolvedDatabaseOptions {
  readonly writer: DatabaseConnectionOptions;

  readonly readers?: readonly DatabaseConnectionOptions[];

  readonly retry?: DatabaseRetryOptions;

  readonly health?: DatabaseHealthOptions;

  readonly autoInitialize?: boolean;

  readonly lifecycle?: DatabaseLifecycleHooks;
}
