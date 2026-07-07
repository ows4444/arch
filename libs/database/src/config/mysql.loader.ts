import { registerAs } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { MySQLEnvironmentSchema } from './mysql.schema';
import { MYSQL_ENV, MySQLBothEnvironment } from './mysql.types';

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
        ssl: config.MYSQL_SSL === 'true' ? config.MYSQL_SSL_CA : undefined,
        synchronize: true, // Set to true for development
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
            ? config.MYSQL_REPLICA_SSL_CA
            : undefined,
      },
      timezone: config.MYSQL_TIME_ZONE,
      replicaMode: config.MYSQL_REPLICA === 'true' ? true : false,
    };
  },
);
