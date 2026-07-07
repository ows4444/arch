import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { DEFAULT_MYSQL_OPTIONS } from '../constants/database.constants';
import { DatabaseConnectionOptions } from '../interfaces/database-connection-options.interface';

@Injectable()
export class DataSourceFactory {
  private readonly logger = new Logger(DataSourceFactory.name);

  private buildConfiguration(
    options: DatabaseConnectionOptions,
  ): MysqlConnectionOptions {
    return {
      ...DEFAULT_MYSQL_OPTIONS,
      ...options,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      extra: {
        ...DEFAULT_MYSQL_OPTIONS.extra,
        ...options.extra,
      },
    } as MysqlConnectionOptions;
  }

  async create(options: DatabaseConnectionOptions): Promise<DataSource> {
    const configuration = this.buildConfiguration(options);

    const dataSource = new DataSource(configuration);

    try {
      await dataSource.initialize();
    } catch (error) {
      if (dataSource.isInitialized) {
        await dataSource.destroy().catch(() => undefined);
      }

      throw error;
    }

    this.logger.log(`Datasource '${options.name ?? 'default'}' initialized.`);

    return dataSource;
  }

  async destroy(dataSource?: DataSource): Promise<void> {
    if (!dataSource?.isInitialized) {
      return;
    }

    await dataSource.destroy();
  }

  async recreate(
    previous: DataSource | undefined,
    options: DatabaseConnectionOptions,
  ): Promise<DataSource> {
    const next = await this.create(options);

    try {
      await this.destroy(previous);
    } catch (error) {
      await this.destroy(next).catch(() => undefined);
      throw error;
    }

    return next;
  }
}
