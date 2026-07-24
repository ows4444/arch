import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { Clock, RedisClient } from '@/cache';
import type { RateLimitMetrics } from './core/rate-limit-metrics.interface';

export type RateLimitAlgorithm = 'sliding-window' | 'token-bucket';

export interface RateLimiterConfig {
  /** Maximum number of allowed requests per window (sliding-window), or bucket capacity (token-bucket). */
  readonly limit: number;

  /**
   * Window size in milliseconds (sliding-window), or the time to refill an
   * empty bucket to full capacity (token-bucket) — i.e. the bucket refills
   * at `limit / windowMs` tokens/ms either way.
   */
  readonly windowMs: number;

  /**
   * `sliding-window` (default) rejects smoothly as the weighted blend of
   * the current/previous fixed windows approaches `limit` — see
   * `RateLimitStore`'s doc comment. `token-bucket` instead allows an
   * instant burst up to `limit` requests, then steadily refills at
   * `limit / windowMs` tokens/ms — the right choice when occasional bursts
   * above the average rate are legitimate traffic, not abuse.
   */
  readonly algorithm?: RateLimitAlgorithm;
}

export type RateLimitStoreConfig =
  | { readonly type: 'memory' }
  | {
      readonly type: 'redis';
      readonly client: RedisClient;
      readonly keyPrefix?: string;
    };

export interface RateLimitModuleOptions {
  /**
   * Named limiter configs, declared up front (topology-as-code style, like
   * `libs/queue`'s `RmqTopologyDefinition[]`). Always the fallback source
   * of truth — even with `rules.enabled: true`, any name with no matching
   * DB row still resolves from here. A `"${name}:role:${role}"` entry
   * scopes a limiter to a specific role — see `RateLimiterRuleContext`.
   */
  readonly limiters: Record<string, RateLimiterConfig>;

  readonly store: RateLimitStoreConfig;

  /**
   * Enables `DatabaseRateLimiterRuleResolver` — admin-editable limiter
   * configs stored in `ratelimit_rules`, overriding `limiters` for any
   * name with a matching DB row, without a redeploy. Requires
   * `RATELIMIT_TYPEORM_ENTITIES`/`RATELIMIT_MIGRATIONS` to be merged into
   * the host's `DatabaseModule.forRoot` call, the same way `libs/auth`/
   * `libs/queue`/etc. already do. Off by default — see `libs/ratelimit`'s
   * ARCH.md for why static config is the default rather than this.
   */
  readonly rules?: {
    readonly enabled?: boolean;

    /** How long a resolved DB rule is cached before re-querying; default 10s. */
    readonly cacheTtlMs?: number;
  };

  /** Overridable for deterministic tests; defaults to `SystemClock`. */
  readonly clock?: Clock;

  /**
   * When the configured store throws (e.g. the Redis connection is down),
   * `RateLimiterService.consume` defaults to *allowing* the request rather
   * than propagating the error — a rate limiter being temporarily
   * unavailable shouldn't take every protected route down with it. Set to
   * `false` for fail-closed behavior instead (the error propagates, and
   * callers — e.g. `RateLimitGuard` — see it as a request failure).
   */
  readonly failOpen?: boolean;

  /** Overridable observability hook; defaults to a no-op. */
  readonly metrics?: RateLimitMetrics;

  /**
   * Registers `RateLimitGuard` as a global `APP_GUARD` unless explicitly
   * set to `false` — matches `libs/cache`'s `registerInterceptor` opt-out
   * shape. A route with no `@RateLimit()` decorator is a no-op even when
   * the guard runs globally, so the default is safe to leave on.
   */
  readonly registerGuard?: boolean;
}

export interface RateLimitOptionsFactory {
  createRateLimitOptions():
    RateLimitModuleOptions | Promise<RateLimitModuleOptions>;
}

export interface RateLimitModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  readonly inject?: (InjectionToken | OptionalFactoryDependency)[];

  readonly useExisting?: Type<RateLimitOptionsFactory>;

  readonly useClass?: Type<RateLimitOptionsFactory>;

  readonly useFactory?: (
    ...args: readonly unknown[]
  ) => RateLimitModuleOptions | Promise<RateLimitModuleOptions>;
}
