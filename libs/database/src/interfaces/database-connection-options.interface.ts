import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';

export interface DatabaseConnectionOptions extends Omit<
  MysqlConnectionOptions,
  'name' | 'type'
> {
  readonly name?: string;
}
