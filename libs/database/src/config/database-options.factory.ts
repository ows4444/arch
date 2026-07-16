import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE_BOOTSTRAP_OPTIONS } from '../constants/database.tokens';
import type { DatabaseBootstrapOptions } from '../interfaces/database-bootstrap-options.interface';
import type { DatabaseOptionsFactory } from '../interfaces/database-options.factory.interface';
import type { ResolvedDatabaseOptions } from '../interfaces/database-resolved-options.interface';
import { MYSQL_ENV, MySQLBothEnvironment } from './mysql.types';

@Injectable()
export class DefaultDatabaseOptionsFactory implements DatabaseOptionsFactory {
  constructor(
    private readonly config: ConfigService,
    @Inject(DATABASE_BOOTSTRAP_OPTIONS)
    private readonly options: DatabaseBootstrapOptions,
  ) {}

  createDatabaseOptions(): ResolvedDatabaseOptions {
    const database = this.config.getOrThrow<MySQLBothEnvironment>(MYSQL_ENV);

    const entities =
      this.options.entities !== undefined
        ? { entities: this.options.entities }
        : {};

    const migrations =
      this.options.migrations !== undefined
        ? { migrations: this.options.migrations }
        : {};

    return {
      writer: {
        ...database.master,
        name: 'writer',

        ...entities,
        ...migrations,
      },

      readers: database.replicaMode
        ? [
            {
              ...database.replica,
              name: 'reader',
              ...entities,
            },
          ]
        : [],
    };
  }
}
