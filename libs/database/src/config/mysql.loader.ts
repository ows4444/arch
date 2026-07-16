import { registerAs } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { MysqlConnectionOptions } from 'typeorm/driver/mysql/MysqlConnectionOptions';
import { MySQLEnvironmentSchema } from './mysql.schema';
import { MYSQL_ENV, MySQLBothEnvironment } from './mysql.types';

function parseLogging(
  value: string | undefined,
): MysqlConnectionOptions['logging'] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  if (value === 'all') {
    return 'all';
  }

  return value.split(',').map((level) => level.trim()) as NonNullable<
    MysqlConnectionOptions['logging']
  >;
}

function poolOverrides(
  connectionLimit: number | undefined,
): Pick<MysqlConnectionOptions, 'poolSize' | 'extra'> {
  return connectionLimit === undefined
    ? {}
    : { poolSize: connectionLimit, extra: { connectionLimit } };
}

function loggingOverrides(
  logLevel: string | undefined,
): Pick<MysqlConnectionOptions, 'logging'> {
  const logging = parseLogging(logLevel);

  return logging === undefined ? {} : { logging };
}

export const databaseLoader = registerAs(
  MYSQL_ENV,
  (): MySQLBothEnvironment => {
    const config = plainToInstance(MySQLEnvironmentSchema, process.env, {
      enableImplicitConversion: true,
      excludeExtraneousValues: true,
    });

    const errors = validateSync(config, {
      skipMissingProperties: false,
      forbidUnknownValues: true,
      whitelist: true,
    });

    if (errors.length > 0) {
      const errorMessages = errors
        .flatMap((error) =>
          Object.values(
            error.constraints ?? { [error.property]: 'Invalid value' },
          ),
        )
        .join('\n- ');
      throw new Error(`Environment validation failed:\n- ${errorMessages}`);
    }

    return {
      master: {
        type: 'mysql',
        host: config.MYSQL_HOST,
        username: config.MYSQL_USERNAME,
        password: config.MYSQL_PASSWORD,
        database: config.MYSQL_DATABASE,
        port: config.MYSQL_PORT,
        ssl:
          config.MYSQL_SSL === 'true' ? { ca: config.MYSQL_SSL_CA } : undefined,
        synchronize: config.MYSQL_SYNCHRONIZE === 'true',
        migrationsRun: config.MYSQL_MIGRATIONS_RUN === 'true',
        ...poolOverrides(config.MYSQL_CONNECTION_LIMIT),
        ...loggingOverrides(config.MYSQL_LOG_LEVEL),
      },
      replica: {
        type: 'mysql',
        host: config.MYSQL_REPLICA_HOST,
        username: config.MYSQL_REPLICA_USERNAME,
        password: config.MYSQL_REPLICA_PASSWORD,
        database: config.MYSQL_REPLICA_DATABASE,
        port: config.MYSQL_REPLICA_PORT,
        ssl:
          config.MYSQL_REPLICA_SSL === 'true'
            ? { ca: config.MYSQL_REPLICA_SSL_CA }
            : undefined,
        synchronize: config.MYSQL_REPLICA_SYNCHRONIZE === 'true',
        ...poolOverrides(config.MYSQL_REPLICA_CONNECTION_LIMIT),
        ...loggingOverrides(config.MYSQL_REPLICA_LOG_LEVEL),
      },
      timezone: config.MYSQL_TIME_ZONE,
      replicaMode: config.MYSQL_REPLICA === 'true' ? true : false,
    };
  },
);
