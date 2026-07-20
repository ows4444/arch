import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import Redis from 'ioredis';
import {
  AuthModule,
  AuthModuleOptions,
  AuthEnvironmentSchema,
  AUTH_TYPEORM_ENTITIES,
  AUTH_MIGRATIONS,
  CacheAccessTokenDenylist,
} from '@/auth';
import {
  CacheModule,
  CacheModuleOptions,
  CacheManager,
  CACHE_MANAGER,
} from '@/cache';
import { DatabaseBootstrapOptions, DatabaseModule } from '@/database';
import { QueueModule, QUEUE_TYPEORM_ENTITIES, QUEUE_MIGRATIONS } from '@/queue';
import {
  ValidationModule,
  VALIDATION_TYPEORM_ENTITIES,
  VALIDATION_MIGRATIONS,
  DefaultValidationErrorFactory,
  DatabaseValidationRuleStore,
  CachedValidationRuleStore,
} from '@/validation';
import {
  WorkflowModule,
  WORKFLOW_TYPEORM_ENTITIES,
  WORKFLOW_MIGRATIONS,
} from '@/workflow';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { IoRedisClientAdapter } from './redis/ioredis-client.adapter';
import { ValidationRuleController } from './validation-rules/validation-rule.controller';

function buildRabbitMqUri(): string {
  const host = process.env.RABBITMQ_HOST ?? 'localhost';
  const port = process.env.RABBITMQ_PORT ?? '5672';
  const username = process.env.RABBITMQ_USERNAME ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';

  return `amqp://${username}:${password}@${host}:${port}`;
}

/**
 * `AuthModule` takes its config via `forRootAsync` options rather than
 * reading `process.env` itself (matching `libs/cache`/`libs/queue`'s
 * host-supplied-config pattern, not `libs/database`'s internal env
 * loader) — so validating `AuthEnvironmentSchema` here, once, at startup
 * is what makes it more than a dead export. Fails fast on a missing or
 * too-short `AUTH_JWT_SECRET` instead of silently accepting a weak one.
 */
function validateAuthEnvironment(): AuthEnvironmentSchema {
  const config = plainToInstance(AuthEnvironmentSchema, process.env, {
    enableImplicitConversion: true,
    excludeExtraneousValues: true,
  });

  const errors = validateSync(config, { skipMissingProperties: false });

  if (errors.length > 0) {
    const errorMessages = errors
      .flatMap((error) =>
        Object.values(
          error.constraints ?? { [error.property]: 'Invalid value' },
        ),
      )
      .join('\n- ');
    throw new Error(`Auth environment validation failed:\n- ${errorMessages}`);
  }

  return config;
}

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    ValidationModule.forRootAsync({
      useFactory: () => new DefaultValidationErrorFactory(),
      rules: {
        enabled: true,
        useFactory: (
          cacheManager: CacheManager,
          databaseStore: DatabaseValidationRuleStore,
        ) => new CachedValidationRuleStore(databaseStore, cacheManager),
        inject: [CACHE_MANAGER, DatabaseValidationRuleStore],
      },
    }),

    DatabaseModule.forRoot({
      entities: [
        ...AUTH_TYPEORM_ENTITIES,
        ...QUEUE_TYPEORM_ENTITIES,
        ...WORKFLOW_TYPEORM_ENTITIES,
        ...VALIDATION_TYPEORM_ENTITIES,
      ] as unknown as DatabaseBootstrapOptions['entities'],

      migrations: [
        ...AUTH_MIGRATIONS,
        ...QUEUE_MIGRATIONS,
        ...WORKFLOW_MIGRATIONS,
        ...VALIDATION_MIGRATIONS,
      ],
    }),

    CacheModule.forRootAsync({
      useFactory: (...args: readonly unknown[]): CacheModuleOptions => {
        const config = args[0] as ConfigService;

        return {
          caches: {
            default: {
              type: 'redis',
              options: {
                client: new IoRedisClientAdapter(
                  new Redis({
                    host: config.getOrThrow<string>('REDIS_HOST'),
                    port: Number(config.getOrThrow<string>('REDIS_PORT')),
                    password: config.get<string>('REDIS_PASSWORD'),
                    tls:
                      config.get<string>('REDIS_TLS') === 'true'
                        ? {}
                        : undefined,
                  }),
                ),
                namespace: 'app',
              },
            },
            'orders-l1': {
              type: 'memory',
              options: { capacity: 500, ttl: 30_000 },
            },
            orders: {
              type: 'multi-level',
              options: { l1: 'orders-l1', l2: 'default' },
            },
          },
        };
      },
      inject: [ConfigService],
    }),

    QueueModule.forRoot({
      uri: buildRabbitMqUri(),
      outbox: {},
      inbox: true,
    }),

    WorkflowModule.forRoot({ persistence: 'database' }),

    AuthModule.forRootAsync({
      useFactory: (...args: readonly unknown[]): AuthModuleOptions => {
        const cacheManager = args[0] as CacheManager;
        const env = validateAuthEnvironment();

        return {
          jwt: {
            secret: env.AUTH_JWT_SECRET,
            ...(env.AUTH_ACCESS_TOKEN_TTL_SECONDS !== undefined && {
              accessTokenTtlSeconds: env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
            }),
          },
          ...(env.AUTH_REFRESH_TOKEN_TTL_SECONDS !== undefined && {
            refreshTokenTtlSeconds: env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
          }),
          // Instant access-token revocation on logout/password change,
          // instead of relying solely on the access token's own short
          // natural expiry (see libs/auth/ARCH.md, Key Decisions MEDIUM #3).
          accessTokenDenylist: new CacheAccessTokenDenylist(cacheManager),
        };
      },
      inject: [CACHE_MANAGER],
    }),
  ],
  controllers: [AppController, ValidationRuleController],
  providers: [AppService],
})
export class AppModule {}
