import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { RATE_LIMIT_MODULE_OPTIONS } from '../ratelimit.constants';
import { RateLimiterRuleResolver } from '../core/rate-limiter-rule-resolver.interface';
import { RateLimiterRuleContext } from '../core/rate-limiter-rule-context.interface';
import type {
  RateLimitModuleOptions,
  RateLimiterConfig,
} from '../ratelimit.types';
import { RateLimitRuleRepository } from '../domain/rate-limit-rule.repository';
import { RateLimitRuleEntity } from '../domain/rate-limit-rule.entity';
import { StaticRateLimiterRuleResolver } from './static-rate-limiter-rule.resolver';

interface CacheEntry {
  readonly config: RateLimiterConfig | undefined;

  readonly expiresAt: number;
}

/**
 * Admin-editable limiter configs, stored in `ratelimit_rules` — the
 * "runtime reconfiguration without a redeploy" option `libs/ratelimit`'s
 * ARCH.md originally deferred. Falls back to `fallback`
 * (`StaticRateLimiterRuleResolver`) whenever no DB row exists for the
 * requested name, so a deployment can override only the specific limiters
 * it wants to manage dynamically, leaving the rest as static config.
 *
 * A small fixed-TTL in-memory cache (`RateLimitModuleOptions.rules.cacheTtlMs`,
 * default 10s) avoids a DB round trip on every single rate-limited request
 * — `ratelimit_rules` changes are operational/admin actions, not something
 * needing sub-second propagation. Deliberately a plain `Map` rather than
 * `@/cache`'s full cache abstraction: the cached shape (a handful of named
 * rules) and lifetime (this resolver instance) don't need eviction
 * policies, multi-level composition, or a Redis-backed L2.
 */
@Injectable()
export class DatabaseRateLimiterRuleResolver implements RateLimiterRuleResolver {
  private readonly logger = new Logger(DatabaseRateLimiterRuleResolver.name);

  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    @InjectRepository(RateLimitRuleRepository)
    private readonly repository: RateLimitRuleRepository,
    @Inject(RATE_LIMIT_MODULE_OPTIONS)
    private readonly options: RateLimitModuleOptions,
    private readonly fallback: StaticRateLimiterRuleResolver,
  ) {}

  private get cacheTtlMs(): number {
    return this.options.rules?.cacheTtlMs ?? 10_000;
  }

  async resolve(
    limiterName: string,
    context?: RateLimiterRuleContext,
  ): Promise<RateLimiterConfig | undefined> {
    if (context?.role) {
      const roleScoped = await this.resolveOne(
        `${limiterName}:role:${context.role}`,
      );

      if (roleScoped) {
        return roleScoped;
      }
    }

    const plain = await this.resolveOne(limiterName);

    if (plain) {
      return plain;
    }

    return this.fallback.resolve(limiterName, context);
  }

  /**
   * A DB read failure (e.g. MySQL connectivity blip) here must not
   * propagate: `RateLimiterService.consume` calls `resolve()` *before* its
   * own fail-open try/catch (which only guards `RateLimitStore.consume`),
   * so an uncaught error here would 5xx every rate-limited route — the
   * exact "an unavailable rate limiter takes down every protected route"
   * failure mode `failOpen` was built to prevent, just via the rule
   * resolver's DB instead of the store's Redis. Treating a failed lookup
   * the same as "no DB row" lets `resolve()`'s existing static-fallback
   * path (below) handle it — the same degradation a genuinely-missing rule
   * already gets. Not cached (unlike a real miss): caching a transient
   * failure for a full `cacheTtlMs` would keep serving the fallback config
   * after the DB has already recovered.
   */
  private async resolveOne(
    name: string,
  ): Promise<RateLimiterConfig | undefined> {
    const cached = this.cache.get(name);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.config;
    }

    let entity: RateLimitRuleEntity | null;

    try {
      entity = await this.repository.findByName(name);
    } catch (error) {
      this.logger.error({
        message:
          'Rate limit rule lookup failed — falling back to static config rather than failing the request',
        name,
        error: error instanceof Error ? error.message : String(error),
      });

      return undefined;
    }

    const config = entity ? this.toConfig(entity) : undefined;

    this.cache.set(name, { config, expiresAt: now + this.cacheTtlMs });

    return config;
  }

  private toConfig(entity: RateLimitRuleEntity): RateLimiterConfig {
    return {
      limit: entity.limit,
      windowMs: entity.windowMs,
      ...(entity.algorithm ? { algorithm: entity.algorithm } : {}),
    };
  }
}
