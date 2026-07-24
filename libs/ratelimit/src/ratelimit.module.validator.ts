import { RateLimitModuleOptions } from './ratelimit.types';
import { RateLimitConfigurationError } from './errors/ratelimit-configuration.error';

export class RateLimitModuleValidator {
  static validate(options: RateLimitModuleOptions): void {
    const names = Object.keys(options.limiters);

    if (names.length === 0) {
      throw new RateLimitConfigurationError(
        'At least one rate limiter must be configured.',
      );
    }

    for (const [name, config] of Object.entries(options.limiters)) {
      if (!Number.isInteger(config.limit) || config.limit <= 0) {
        throw new RateLimitConfigurationError(
          `Rate limiter '${name}' has an invalid limit: ${config.limit}. Must be a positive integer.`,
        );
      }

      if (!Number.isFinite(config.windowMs) || config.windowMs <= 0) {
        throw new RateLimitConfigurationError(
          `Rate limiter '${name}' has an invalid windowMs: ${config.windowMs}. Must be a positive number.`,
        );
      }
    }

    if (options.store.type === 'redis' && !options.store.client.eval) {
      throw new RateLimitConfigurationError(
        'Redis-backed rate limiting requires a RedisClient with eval() support (atomic Lua ' +
          'execution) — the configured client does not implement it.',
      );
    }
  }
}
