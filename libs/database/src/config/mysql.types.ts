import { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';

export const MYSQL_ENV = 'MYSQL_ENV';

export interface MySQLBothEnvironment {
  replica: MysqlConnectionOptions;
  master: MysqlConnectionOptions;
  timezone: string;
  replicaMode: boolean;
}
