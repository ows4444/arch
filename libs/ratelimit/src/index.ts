/*
 * Module
 */
export * from './ratelimit.module';
export * from './ratelimit.constants';
export type {
  RateLimitModuleOptions,
  RateLimitModuleAsyncOptions,
  RateLimitOptionsFactory,
  RateLimiterConfig,
  RateLimitStoreConfig,
  RateLimitAlgorithm,
} from './ratelimit.types';

/*
 * Core
 */
export type { RateLimitStore } from './core/rate-limit-store.interface';
export type { RateLimitResult } from './core/rate-limit-result.interface';
export type { RateLimitMetrics } from './core/rate-limit-metrics.interface';
export type { RateLimiterRuleResolver } from './core/rate-limiter-rule-resolver.interface';
export type { RateLimiterRuleContext } from './core/rate-limiter-rule-context.interface';

/*
 * Stores
 */
export * from './stores/memory-rate-limit.store';
export * from './stores/redis-rate-limit.store';

/*
 * Metrics
 */
export * from './metrics/noop-rate-limit-metrics';

/*
 * Resolvers
 */
export * from './resolvers/static-rate-limiter-rule.resolver';
export * from './resolvers/database-rate-limiter-rule.resolver';

/*
 * Application
 */
export * from './application/rate-limiter.service';

/*
 * HTTP
 */
export * from './http/rate-limit.decorator';
export * from './http/rate-limit.guard';

/*
 * Errors
 */
export * from './errors/ratelimit-configuration.error';
export * from './errors/too-many-requests.error';

/*
 * Domain
 */
export * from './domain/rate-limit-rule.entity';
export * from './domain/rate-limit-rule.repository';

/*
 * Persistence
 */
export { RATELIMIT_TYPEORM_ENTITIES } from './persistence/entities';
export { RATELIMIT_MIGRATIONS } from './persistence/migrations';
