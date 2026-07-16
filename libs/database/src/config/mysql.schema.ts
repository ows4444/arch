import { Expose, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class MySQLEnvironmentSchema {
  @Expose()
  @IsString()
  MYSQL_HOST!: string;

  @Expose()
  @IsString()
  MYSQL_USERNAME!: string;

  @Expose()
  @IsString()
  MYSQL_PASSWORD!: string;

  @Expose()
  @IsString()
  MYSQL_DATABASE!: string;

  @Expose()
  @IsInt()
  @Min(0)
  @Max(65535)
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  MYSQL_PORT!: number;

  @Expose()
  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  MYSQL_CONNECTION_LIMIT!: number;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_SYNCHRONIZE!: string;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_MIGRATIONS_RUN!: string;

  @Expose()
  @IsString()
  @IsOptional()
  MYSQL_LOG_LEVEL!: string;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_SSL!: string;

  @Expose()
  @IsString()
  @ValidateIf(
    (o: MySQLEnvironmentSchema) => o.MYSQL_SSL?.toLowerCase() === 'true',
  )
  @IsNotEmpty({ message: 'MYSQL_SSL_CA is required when SSL is enabled' })
  MYSQL_SSL_CA!: string;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_REPLICA!: string;

  @Expose()
  @IsString()
  @ValidateIf((o: MySQLEnvironmentSchema) => o.MYSQL_REPLICA === 'true')
  MYSQL_REPLICA_HOST!: string;

  @Expose()
  @IsString()
  @ValidateIf((o: MySQLEnvironmentSchema) => o.MYSQL_REPLICA === 'true')
  MYSQL_REPLICA_USERNAME!: string;

  @Expose()
  @IsString()
  @ValidateIf((o: MySQLEnvironmentSchema) => o.MYSQL_REPLICA === 'true')
  MYSQL_REPLICA_PASSWORD!: string;

  @Expose()
  @IsString()
  @ValidateIf((o: MySQLEnvironmentSchema) => o.MYSQL_REPLICA === 'true')
  MYSQL_REPLICA_DATABASE!: string;

  @Expose()
  @IsInt()
  @Min(0)
  @Max(65535)
  @Transform(({ value }: { value: string }) => parseInt(value, 10))
  @ValidateIf((o: MySQLEnvironmentSchema) => o.MYSQL_REPLICA === 'true')
  MYSQL_REPLICA_PORT!: number;

  @Expose()
  @IsString()
  MYSQL_TIME_ZONE!: string;

  @Expose()
  @IsInt()
  @Min(0)
  @Max(50)
  @IsOptional()
  MYSQL_REPLICA_CONNECTION_LIMIT!: number;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_REPLICA_SYNCHRONIZE!: string;

  @Expose()
  @IsString()
  @IsOptional()
  MYSQL_REPLICA_LOG_LEVEL!: string;

  @Expose()
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  MYSQL_REPLICA_SSL!: string;

  @Expose()
  @IsString()
  @IsOptional()
  @ValidateIf(
    (o: MySQLEnvironmentSchema) =>
      o.MYSQL_REPLICA_SSL?.toLowerCase() === 'true',
  )
  @IsNotEmpty({
    message: 'MYSQL_REPLICA_SSL_CA is required when SSL is enabled',
  })
  MYSQL_REPLICA_SSL_CA!: string;
}
