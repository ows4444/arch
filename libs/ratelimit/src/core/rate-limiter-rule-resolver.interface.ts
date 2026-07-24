import { RateLimiterConfig } from '../ratelimit.types';
import { RateLimiterRuleContext } from './rate-limiter-rule-context.interface';

/**
 * Resolves the effective `RateLimiterConfig` for a given limiter name (and
 * optional role-scoping context) — the one seam that lets rules be static
 * (`StaticRateLimiterRuleResolver`, the default), DB-backed and
 * admin-editable (`DatabaseRateLimiterRuleResolver`), or role-aware,
 * without `RateLimiterService` knowing which.
 */
export interface RateLimiterRuleResolver {
  resolve(
    limiterName: string,
    context?: RateLimiterRuleContext,
  ): Promise<RateLimiterConfig | undefined>;
}
