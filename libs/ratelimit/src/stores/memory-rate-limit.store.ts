import { Injectable } from '@nestjs/common';
import type { Clock } from '@/cache';
import { SystemClock } from '@/cache';
import { RateLimitStore } from '../core/rate-limit-store.interface';
import { RateLimitResult } from '../core/rate-limit-result.interface';
import { RateLimiterConfig } from '../ratelimit.types';

interface WindowEntry {
  windowStart: number;

  currentCount: number;

  previousCount: number;
}

interface BucketEntry {
  tokens: number;

  lastRefillAt: number;
}

/**
 * Single-instance, in-process store — correct only within one process.
 * Fine for local dev/tests or a genuinely single-instance deployment; a
 * horizontally-scaled `apps/server` needs `RedisRateLimitStore` instead,
 * since each replica would otherwise track its own independent counters
 * (effectively multiplying the real limit by the replica count).
 *
 * Known accepted limitation: entries are never actively evicted — a
 * `Map` entry per distinct `key` value lives until overwritten by that same
 * key's next request. Unbounded if callers use unbounded-cardinality keys
 * (e.g. raw IP addresses under high unique-visitor churn) without ever
 * restarting the process. Not addressed here since it doesn't affect
 * correctness, only long-running memory footprint, and no concrete
 * incident has driven the need for active cleanup.
 */
@Injectable()
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, WindowEntry>();

  private readonly buckets = new Map<string, BucketEntry>();

  constructor(private readonly clock: Clock = new SystemClock()) {}

  consume(key: string, config: RateLimiterConfig): Promise<RateLimitResult> {
    if (config.algorithm === 'token-bucket') {
      return this.consumeTokenBucket(key, config);
    }

    return this.consumeSlidingWindow(key, config);
  }

  private consumeSlidingWindow(
    key: string,
    { limit, windowMs }: RateLimiterConfig,
  ): Promise<RateLimitResult> {
    const now = this.clock.now();
    const windowStart = now - (now % windowMs);
    const elapsed = now - windowStart;
    const weight = 1 - elapsed / windowMs;

    const existing = this.windows.get(key);

    let currentCount = 0;
    let previousCount = 0;

    if (existing) {
      if (existing.windowStart === windowStart) {
        currentCount = existing.currentCount;
        previousCount = existing.previousCount;
      } else if (existing.windowStart === windowStart - windowMs) {
        currentCount = 0;
        previousCount = existing.currentCount;
      }
      // Otherwise the entry is more than one window stale — treat as fresh
      // (currentCount/previousCount both 0), same as no entry at all.
    }

    const estimated = previousCount * weight + currentCount + 1;
    const allowed = estimated <= limit;

    if (allowed) {
      currentCount += 1;
      this.windows.set(key, { windowStart, currentCount, previousCount });
    }

    const remaining = Math.max(
      0,
      Math.floor(limit - (previousCount * weight + currentCount)),
    );

    return Promise.resolve({
      allowed,
      limit,
      remaining,
      resetAt: new Date(windowStart + windowMs),
    });
  }

  /**
   * Bucket starts full (`limit` tokens) rather than empty — a fresh key's
   * first requests aren't penalized for a burst the caller never actually
   * made. Refills continuously (fractional tokens tracked internally, not
   * just on whole-token boundaries) at `limit / windowMs` tokens/ms.
   */
  private consumeTokenBucket(
    key: string,
    { limit, windowMs }: RateLimiterConfig,
  ): Promise<RateLimitResult> {
    const now = this.clock.now();
    const refillRatePerMs = limit / windowMs;

    const existing = this.buckets.get(key);
    const tokensBeforeRequest = existing
      ? Math.min(
          limit,
          existing.tokens + (now - existing.lastRefillAt) * refillRatePerMs,
        )
      : limit;

    const allowed = tokensBeforeRequest >= 1;
    const tokens = allowed ? tokensBeforeRequest - 1 : tokensBeforeRequest;

    this.buckets.set(key, { tokens, lastRefillAt: now });

    const msUntilFull = (limit - tokens) / refillRatePerMs;

    return Promise.resolve({
      allowed,
      limit,
      remaining: Math.floor(tokens),
      resetAt: new Date(now + msUntilFull),
    });
  }
}
