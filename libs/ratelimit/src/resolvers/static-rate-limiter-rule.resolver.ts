import { Inject, Injectable } from '@nestjs/common';
import { RATE_LIMIT_MODULE_OPTIONS } from '../ratelimit.constants';
import { RateLimiterRuleResolver } from '../core/rate-limiter-rule-resolver.interface';
import { RateLimiterRuleContext } from '../core/rate-limiter-rule-context.interface';
import type {
  RateLimitModuleOptions,
  RateLimiterConfig,
} from '../ratelimit.types';

/**
 * The default resolver — wraps `RateLimitModuleOptions.limiters` (the
 * static, code-declared map) with no I/O. Role-scoping still works here:
 * registering an entry named `"login:role:admin"` in the same `limiters`
 * map is enough, no DB required.
 */
@Injectable()
export class StaticRateLimiterRuleResolver implements RateLimiterRuleResolver {
  constructor(
    @Inject(RATE_LIMIT_MODULE_OPTIONS)
    private readonly options: RateLimitModuleOptions,
  ) {}

  resolve(
    limiterName: string,
    context?: RateLimiterRuleContext,
  ): Promise<RateLimiterConfig | undefined> {
    const limiters = this.options.limiters;

    if (context?.role) {
      const roleScoped = limiters[`${limiterName}:role:${context.role}`];

      if (roleScoped) {
        return Promise.resolve(roleScoped);
      }
    }

    return Promise.resolve(limiters[limiterName]);
  }
}
