import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions.js';

export const MYSQL_ENV = 'MYSQL_ENV';

export interface MySQLBothEnvironment {
  replica: MysqlConnectionOptions;
  master: MysqlConnectionOptions;
  timezone: string;
  replicaMode: boolean;
}
