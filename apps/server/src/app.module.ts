import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import Redis from 'ioredis';
import { AuditModule, AUDIT_TYPEORM_ENTITIES, AUDIT_MIGRATIONS } from '@/audit';
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
import { DatabaseModule } from '@/database';
import { NotificationModule, LoggingEmailSender } from '@/notification';
import {
  OrganizationsModule,
  ORGANIZATIONS_TYPEORM_ENTITIES,
  ORGANIZATIONS_MIGRATIONS,
} from '@/organizations';
import {
  SchedulerModule,
  SCHEDULER_TYPEORM_ENTITIES,
  SCHEDULER_MIGRATIONS,
} from '@/scheduler';
import {
  OutboxService,
  QueueModule,
  QUEUE_TYPEORM_ENTITIES,
  QUEUE_MIGRATIONS,
} from '@/queue';
import {
  RateLimitModule,
  RATELIMIT_TYPEORM_ENTITIES,
  RATELIMIT_MIGRATIONS,
} from '@/ratelimit';
import { UsersModule, USERS_TYPEORM_ENTITIES, USERS_MIGRATIONS } from '@/users';
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
import { RequestIdMiddleware } from './request-context/request-id.middleware';
import { HealthController } from './health/health.controller';
import { QueueAuthEventPublisher } from './notifications/queue-auth-event-publisher';

function buildRabbitMqUri(): string {
  const host = process.env.RABBITMQ_HOST ?? 'localhost';
  const port = process.env.RABBITMQ_PORT ?? '5672';
  const username = process.env.RABBITMQ_USERNAME ?? 'guest';
  const password = process.env.RABBITMQ_PASSWORD ?? 'guest';

  return `amqp://${username}:${password}@${host}:${port}`;
}

/**
 * `RateLimitModule.forRoot` (not `forRootAsync`) is required for
 * `rules.enabled` — `DatabaseRateLimiterRuleResolver` needs
 * `RateLimitRuleRepository` statically injectable, which `forRootAsync`
 * can't support (see `libs/ratelimit/ARCH.md` Design 007). `forRoot` needs
 * synchronous options, so this reads `process.env` directly rather than
 * going through the injected `ConfigService` `CacheModule` uses — same
 * "read `process.env` directly for a synchronously-needed value" approach
 * `buildRabbitMqUri` above and `validateAuthEnvironment` below already
 * use in this file, just for Redis instead of RabbitMQ/JWT.
 */
function buildRedisConnectionOptions(): {
  host: string;
  port: number;
  password?: string;
  tls?: Record<string, never>;
} {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;

  if (!host) {
    throw new Error('REDIS_HOST is required.');
  }

  if (!port) {
    throw new Error('REDIS_PORT is required.');
  }

  return {
    host,
    port: Number(port),
    ...(process.env.REDIS_PASSWORD !== undefined && {
      password: process.env.REDIS_PASSWORD,
    }),
    ...(process.env.REDIS_TLS === 'true' && { tls: {} }),
  };
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
        ...RATELIMIT_TYPEORM_ENTITIES,
        ...USERS_TYPEORM_ENTITIES,
        ...AUDIT_TYPEORM_ENTITIES,
        ...ORGANIZATIONS_TYPEORM_ENTITIES,
        ...SCHEDULER_TYPEORM_ENTITIES,
      ],

      // USERS_MIGRATIONS/ORGANIZATIONS_MIGRATIONS must come after
      // AUTH_MIGRATIONS: their seed migrations grant `users:manage`/
      // `organizations:manage` to the `admin` role AUTH_MIGRATIONS creates
      // (see libs/users'/libs/organizations' Seed*ManagePermission
      // migrations). SCHEDULER_MIGRATIONS has no such ordering dependency —
      // it grants no permission and seeds no role (see
      // libs/scheduler/ARCH.md, Security Architecture: no HTTP surface, no
      // RBAC involvement at all).
      migrations: [
        ...AUTH_MIGRATIONS,
        ...QUEUE_MIGRATIONS,
        ...WORKFLOW_MIGRATIONS,
        ...VALIDATION_MIGRATIONS,
        ...RATELIMIT_MIGRATIONS,
        ...USERS_MIGRATIONS,
        ...AUDIT_MIGRATIONS,
        ...ORGANIZATIONS_MIGRATIONS,
        ...SCHEDULER_MIGRATIONS,
      ],
    }),

    AuditModule.forRoot(),

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

    // LoggingEmailSender instead of the no-op default — the closest thing
    // to a "real" adapter available without an actual SMTP/SendGrid/SES
    // dependency (see libs/notification/ARCH.md, Rejected Alternatives).
    NotificationModule.forRoot({ emailSender: new LoggingEmailSender() }),

    // A separate Redis connection from CacheModule's — mirrors
    // TopologyBootstrap's own separate raw AMQP connection in libs/queue
    // (same "distinct concern, not worth threading through an existing
    // module's internals" reasoning), rather than refactoring CacheModule's
    // inline client construction just to share one.
    RateLimitModule.forRoot({
      limiters: {
        // 5 attempts per minute per IP — brute-force protection for
        // AuthController.login (see libs/auth/ARCH.md and
        // libs/ratelimit/ARCH.md's Open Questions, now resolved).
        login: { limit: 5, windowMs: 60_000 },
        // 5 registrations per hour per IP — throttles mass/bot account
        // creation without meaningfully affecting a real user (who
        // registers once).
        register: { limit: 5, windowMs: 60 * 60_000 },
        // 5 requests per 15 minutes per IP, shared by both
        // password-reset/request (throttles email-spam abuse) and
        // password-reset/confirm (throttles token-guessing) — the two
        // endpoints are one flow, so one limiter covers both.
        'password-reset': { limit: 5, windowMs: 15 * 60_000 },
        // Same shape as password-reset, shared by both
        // email-verification/request (email-spam abuse) and
        // email-verification/confirm (token-guessing) — one flow, one
        // limiter.
        'email-verification': { limit: 5, windowMs: 15 * 60_000 },
        // The only limiter role-scoping actually applies to today: every
        // limiter above protects a @Public() route, where RateLimitGuard
        // never sees an authenticated request.user to read a role from
        // (see libs/ratelimit/ARCH.md Design 008). 10/hour is generous for
        // a real user (who changes their password rarely) while still
        // throttling abuse of a stolen access token; admins get a higher
        // ceiling for legitimate account-cleanup-type work.
        'change-password': { limit: 10, windowMs: 60 * 60_000 },
        'change-password:role:admin': { limit: 50, windowMs: 60 * 60_000 },
        // Same shape as password-reset/email-verification: one flow
        // (POST /auth/mfa/verify), 5 attempts per 15 minutes per IP —
        // throttles TOTP/recovery-code guessing against a stolen or
        // guessed challenge token (see libs/auth/ARCH.md Design 009).
        'mfa-verify': { limit: 5, windowMs: 15 * 60_000 },
      },
      store: {
        type: 'redis',
        client: new IoRedisClientAdapter(
          new Redis(buildRedisConnectionOptions()),
        ),
        keyPrefix: 'ratelimit',
      },
      // Admin-editable overrides for any of the limiters above, without a
      // redeploy — see libs/ratelimit/ARCH.md Design 007/008.
      rules: { enabled: true },
    }),

    WorkflowModule.forRoot({ persistence: 'database' }),

    AuthModule.forRootAsync({
      useFactory: (...args: readonly unknown[]): AuthModuleOptions => {
        const cacheManager = args[0] as CacheManager;
        const outbox = args[1] as OutboxService;
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
          // MFA stays inert (AesGcmMfaSecretCipher throws only if actually
          // used) when AUTH_MFA_ENCRYPTION_KEY is unset — see
          // libs/auth/ARCH.md Design 009.
          ...(env.AUTH_MFA_ENCRYPTION_KEY !== undefined && {
            mfa: { encryptionKey: env.AUTH_MFA_ENCRYPTION_KEY },
          }),
          // Instant access-token revocation on logout/password change,
          // instead of relying solely on the access token's own short
          // natural expiry (see libs/auth/ARCH.md, Key Decisions MEDIUM #3).
          accessTokenDenylist: new CacheAccessTokenDenylist(cacheManager),
          // The first real (non-no-op) AuthEventPublisher this monorepo has
          // wired — see apps/server/src/notifications/
          // queue-auth-event-publisher.ts and libs/notification/ARCH.md.
          eventPublisher: new QueueAuthEventPublisher(outbox),
        };
      },
      inject: [CACHE_MANAGER, OutboxService],
    }),

    UsersModule.forRoot(),

    OrganizationsModule.forRoot(),

    SchedulerModule.forRoot(),
  ],
  controllers: [AppController, ValidationRuleController, HealthController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
