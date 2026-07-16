import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
  DATABASE_BOOTSTRAP_OPTIONS,
  DATABASE_MODULE_OPTIONS,
} from '../constants/database.tokens';
import { ConnectionMonitor } from '../datasource/connection-monitor';
import { DataSourceFactory } from '../datasource/datasource.factory';
import { DataSourceManager } from '../datasource/datasource.manager';
import type { DatabaseModuleAsyncOptions } from '../interfaces/database-module-options';
import { DatabaseOptionsFactory } from '../interfaces/database-options.factory.interface';
import { RepositoryResolver } from '../repository/repository-resolver';
import { RepositoryProviderFactory } from '../repository/repository.providers';
import { getDatabaseAccessorToken } from '../repository/datasource.tokens';
import { DatabaseAccessor } from '../database/database-accessor';
import { DatabaseRole } from '../constants/database-role.enum';
import { TransactionExecutor } from '../transaction';

import { DatabaseHealthService } from '../health/database-health.service';
import { DiscoveryModule } from '@nestjs/core';
import { RepositoryRegistry } from '../repository/repository.registry';
import { TransactionProviderEnhancer } from '../transaction/transaction-provider-enhancer';
import { RepositoryDiscoveryService } from '../repository/repository-discovery.service';

@Global()
@Module({})
export class DatabaseCoreModule {
  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    const repositoryProviders = RepositoryProviderFactory.create(
      RepositoryRegistry.all(),
    );

    return {
      module: DatabaseCoreModule,
      global: options.global ?? true,

      imports: [DiscoveryModule, ...(options.imports ?? [])],

      providers: [
        ...this.createAsyncProviders(options),
        TransactionExecutor,
        TransactionProviderEnhancer,

        DataSourceFactory,
        DataSourceManager,
        RepositoryResolver,
        RepositoryDiscoveryService,
        ...this.createDatabaseAccessorProviders(),
        ConnectionMonitor,
        DatabaseHealthService,
        ...repositoryProviders,
      ],

      exports: [
        DataSourceManager,
        RepositoryResolver,
        TransactionExecutor,
        DatabaseHealthService,
        getDatabaseAccessorToken(DatabaseRole.READ),
        getDatabaseAccessorToken(DatabaseRole.WRITE),
        ...repositoryProviders,
      ],
    };
  }

  private static createDatabaseAccessorProviders(): Provider[] {
    return [
      {
        provide: getDatabaseAccessorToken(DatabaseRole.READ),
        inject: [RepositoryResolver],
        useFactory: (resolver: RepositoryResolver) =>
          new DatabaseAccessor(DatabaseRole.READ, resolver),
      },
      {
        provide: getDatabaseAccessorToken(DatabaseRole.WRITE),
        inject: [RepositoryResolver],
        useFactory: (resolver: RepositoryResolver) =>
          new DatabaseAccessor(DatabaseRole.WRITE, resolver),
      },
    ];
  }

  private static createAsyncProviders(
    options: DatabaseModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: DATABASE_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: DATABASE_MODULE_OPTIONS,
          useFactory: (factory: DatabaseOptionsFactory) =>
            factory.createDatabaseOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        {
          provide: DATABASE_BOOTSTRAP_OPTIONS,
          useValue: {
            entities: options.entities,
            migrations: options.migrations,
          },
        },

        options.useClass,
        {
          provide: DATABASE_MODULE_OPTIONS,
          useFactory: (factory: DatabaseOptionsFactory) =>
            factory.createDatabaseOptions(),

          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid DatabaseModuleAsyncOptions.');
  }
}
