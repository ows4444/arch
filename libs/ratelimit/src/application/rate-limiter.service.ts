import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  RATE_LIMIT_METRICS,
  RATE_LIMIT_MODULE_OPTIONS,
  RATE_LIMIT_RULE_RESOLVER,
  RATE_LIMIT_STORE,
} from '../ratelimit.constants';
import type { RateLimitModuleOptions } from '../ratelimit.types';
import type { RateLimitStore } from '../core/rate-limit-store.interface';
import type { RateLimitMetrics } from '../core/rate-limit-metrics.interface';
import type { RateLimiterRuleResolver } from '../core/rate-limiter-rule-resolver.interface';
import type { RateLimiterRuleContext } from '../core/rate-limiter-rule-context.interface';
import { RateLimitResult } from '../core/rate-limit-result.interface';
import { RateLimitConfigurationError } from '../errors/ratelimit-configuration.error';

/**
 * The programmatic entry point — usable outside HTTP (e.g. a queue
 * consumer, or `AuthService.login` guarding against credential-stuffing at
 * the service layer directly rather than only at the route). `RateLimitGuard`
 * is a thin HTTP-specific wrapper over this same service.
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);

  constructor(
    @Inject(RATE_LIMIT_MODULE_OPTIONS)
    private readonly options: RateLimitModuleOptions,
    @Inject(RATE_LIMIT_STORE)
    private readonly store: RateLimitStore,
    @Inject(RATE_LIMIT_METRICS)
    private readonly metrics: RateLimitMetrics,
    @Inject(RATE_LIMIT_RULE_RESOLVER)
    private readonly resolver: RateLimiterRuleResolver,
  ) {}

  async consume(
    limiterName: string,
    key: string,
    context?: RateLimiterRuleContext,
  ): Promise<RateLimitResult> {
    const config = await this.resolver.resolve(limiterName, context);

    if (!config) {
      throw new RateLimitConfigurationError(
        `No rate limiter configured named '${limiterName}'` +
          (context?.role ? ` (role '${context.role}')` : '') +
          '.',
      );
    }

    try {
      // `encodeURIComponent` only the caller-supplied `key`, not
      // `limiterName` — `key` is free-form (IPv6 addresses, a userId, or
      // whatever a custom `keyBy` resolver returns) and can contain `:`,
      // while `limiterName` is a fixed literal declared in this app's own
      // rate-limit config. Without escaping, limiterName="a:b"/key="c" and
      // limiterName="a"/key="b:c" would both produce the store key
      // "a:b:c", letting two unrelated limiters/keys share one counter —
      // effectively a rate-limit bucket collision (DoS on an innocent
      // client, or a smuggled bypass of a different route's limit).
      const result = await this.store.consume(
        `${limiterName}:${encodeURIComponent(key)}`,
        config,
      );

      if (result.allowed) {
        this.metrics.requestAllowed(limiterName);
      } else {
        this.metrics.requestRejected(limiterName);
        this.logger.warn({
          message: 'Rate limit exceeded',
          limiterName,
          key,
        });
      }

      return result;
    } catch (error) {
      if (this.options.failOpen === false) {
        throw error;
      }

      this.metrics.storeFailure(limiterName);
      this.logger.error({
        message:
          'Rate limit store failed — failing open (allowing the request) rather than blocking it',
        limiterName,
        key,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        allowed: true,
        limit: config.limit,
        remaining: config.limit,
        resetAt: new Date(Date.now() + config.windowMs),
      };
    }
  }
}
