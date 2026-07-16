import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseConfigModule } from '../config/database-config.module';
import { DefaultDatabaseOptionsFactory } from '../config/database-options.factory';
import type { DatabaseModuleAsyncOptions } from '../interfaces/database-module-options';
import { DatabaseModuleOptions } from '../interfaces/database-options.interface';
import { DatabaseCoreModule } from './database-core.module';

@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return DatabaseCoreModule.forRootAsync({
      imports: [ConfigModule, DatabaseConfigModule],
      useClass: DefaultDatabaseOptionsFactory,
      entities: options.entities,
      migrations: options.migrations,
    });
  }

  static forRootAsync(options: DatabaseModuleAsyncOptions): DynamicModule {
    return DatabaseCoreModule.forRootAsync(options);
  }
}
