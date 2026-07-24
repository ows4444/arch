import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  RATE_LIMIT_METRICS,
  RATE_LIMIT_MODULE_OPTIONS,
  RATE_LIMIT_RULE_RESOLVER,
  RATE_LIMIT_STORE,
} from './ratelimit.constants';
import type {
  RateLimitModuleAsyncOptions,
  RateLimitModuleOptions,
  RateLimitOptionsFactory,
} from './ratelimit.types';
import { RateLimitModuleValidator } from './ratelimit.module.validator';
import { RateLimitStore } from './core/rate-limit-store.interface';
import { MemoryRateLimitStore } from './stores/memory-rate-limit.store';
import { RedisRateLimitStore } from './stores/redis-rate-limit.store';
import { NoopRateLimitMetrics } from './metrics/noop-rate-limit-metrics';
import { StaticRateLimiterRuleResolver } from './resolvers/static-rate-limiter-rule.resolver';
import { DatabaseRateLimiterRuleResolver } from './resolvers/database-rate-limiter-rule.resolver';
import { RateLimiterService } from './application/rate-limiter.service';
import { RateLimitGuard } from './http/rate-limit.guard';

const CORE_EXPORTS = [
  RATE_LIMIT_MODULE_OPTIONS,
  RATE_LIMIT_STORE,
  RATE_LIMIT_METRICS,
  RATE_LIMIT_RULE_RESOLVER,
  RateLimiterService,
  RateLimitGuard,
];

@Global()
@Module({})
export class RateLimitModule {
  static forRoot(options: RateLimitModuleOptions): DynamicModule {
    RateLimitModuleValidator.validate(options);

    const rulesEnabled = options.rules?.enabled === true;

    return {
      module: RateLimitModule,
      global: true,
      providers: [
        { provide: RATE_LIMIT_MODULE_OPTIONS, useValue: options },
        {
          provide: RATE_LIMIT_STORE,
          useFactory: () => this.createStore(options),
        },
        {
          provide: RATE_LIMIT_METRICS,
          useValue: options.metrics ?? new NoopRateLimitMetrics(),
        },
        StaticRateLimiterRuleResolver,
        ...(rulesEnabled ? [DatabaseRateLimiterRuleResolver] : []),
        {
          provide: RATE_LIMIT_RULE_RESOLVER,
          useExisting: rulesEnabled
            ? DatabaseRateLimiterRuleResolver
            : StaticRateLimiterRuleResolver,
        },
        RateLimiterService,
        RateLimitGuard,
        ...this.guardProviders(options.registerGuard),
      ],
      exports: CORE_EXPORTS,
    };
  }

  /**
   * `registerGuard: false` isn't honored here (unlike `forRoot`) — whether
   * `RateLimitGuard` is registered as `APP_GUARD` is a static provider-list
   * decision, but `registerGuard` only becomes known once the async
   * factory/config resolves at runtime. Since the guard is already a safe
   * no-op for any route without `@RateLimit()`, always registering it is
   * the acceptable default rather than adding a second config resolution
   * pass just to gate this one static list.
   *
   * Same reasoning applies to `rules.enabled`: `DatabaseRateLimiterRuleResolver`
   * needs `RateLimitRuleRepository` injectable *unconditionally* to be a
   * static provider entry, which would force every `forRootAsync` consumer
   * to merge `RATELIMIT_TYPEORM_ENTITIES` into `DatabaseModule.forRoot`
   * even if they never enable DB-backed rules — defeating the point of it
   * being optional. DB-backed rules are therefore only available via
   * `forRoot`, not `forRootAsync`, in this version.
   */
  static forRootAsync(options: RateLimitModuleAsyncOptions): DynamicModule {
    return {
      module: RateLimitModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        {
          provide: RATE_LIMIT_STORE,
          useFactory: (moduleOptions: RateLimitModuleOptions) => {
            RateLimitModuleValidator.validate(moduleOptions);
            return this.createStore(moduleOptions);
          },
          inject: [RATE_LIMIT_MODULE_OPTIONS],
        },
        {
          provide: RATE_LIMIT_METRICS,
          useFactory: (moduleOptions: RateLimitModuleOptions) =>
            moduleOptions.metrics ?? new NoopRateLimitMetrics(),
          inject: [RATE_LIMIT_MODULE_OPTIONS],
        },
        StaticRateLimiterRuleResolver,
        {
          provide: RATE_LIMIT_RULE_RESOLVER,
          useExisting: StaticRateLimiterRuleResolver,
        },
        RateLimiterService,
        RateLimitGuard,
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static createAsyncOptionsProviders(
    options: RateLimitModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: RATE_LIMIT_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: RATE_LIMIT_MODULE_OPTIONS,
          useFactory: (factory: RateLimitOptionsFactory) =>
            factory.createRateLimitOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: RATE_LIMIT_MODULE_OPTIONS,
          useFactory: (factory: RateLimitOptionsFactory) =>
            factory.createRateLimitOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid RateLimitModuleAsyncOptions.');
  }

  private static createStore(options: RateLimitModuleOptions): RateLimitStore {
    if (options.store.type === 'redis') {
      return new RedisRateLimitStore(
        options.store.client,
        options.store.keyPrefix,
        options.clock,
      );
    }

    return new MemoryRateLimitStore(options.clock);
  }

  private static guardProviders(
    registerGuard: boolean | undefined,
  ): Provider[] {
    if (registerGuard === false) {
      return [];
    }

    return [{ provide: APP_GUARD, useClass: RateLimitGuard }];
  }
}
