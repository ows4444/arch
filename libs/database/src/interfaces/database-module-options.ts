import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { DatabaseBootstrapOptions } from './database-bootstrap-options.interface';
import type { DatabaseOptionsFactory } from './database-options.factory.interface';
import type { ResolvedDatabaseOptions } from './database-resolved-options.interface';
import { DataSourceState } from './datasource-state';

export interface DatabaseModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'>, DatabaseBootstrapOptions {
  readonly useExisting?: Type<DatabaseOptionsFactory>;

  readonly useClass?: Type<DatabaseOptionsFactory>;

  readonly useFactory?: (
    ...args: unknown[]
  ) => Promise<ResolvedDatabaseOptions> | ResolvedDatabaseOptions;

  readonly inject?: Array<InjectionToken | OptionalFactoryDependency>;

  readonly global?: boolean;
}

export interface DatabaseLifecycleHooks {
  readonly onConnected?: (
    state: Readonly<DataSourceState>,
  ) => void | Promise<void>;

  readonly onDisconnected?: (
    state: Readonly<DataSourceState>,
  ) => void | Promise<void>;

  readonly onReconnect?: (
    state: Readonly<DataSourceState>,
  ) => void | Promise<void>;

  readonly onHealthChanged?: (
    state: Readonly<DataSourceState>,
  ) => void | Promise<void>;
}
