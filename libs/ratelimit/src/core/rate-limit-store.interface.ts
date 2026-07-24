import { RateLimiterConfig } from '../ratelimit.types';
import { RateLimitResult } from './rate-limit-result.interface';

/**
 * A single atomic "consume one unit of quota" operation, dispatching on
 * `config.algorithm` (defaults to `'sliding-window'`) — see
 * `RateLimiterConfig`'s doc comment for what each algorithm does.
 * `MemoryRateLimitStore`/`RedisRateLimitStore` are the two shipped
 * implementations; both must implement each algorithm atomically — see
 * each store's own doc comment for how.
 */
export interface RateLimitStore {
  consume(key: string, config: RateLimiterConfig): Promise<RateLimitResult>;
}
