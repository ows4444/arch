import { Injectable } from '@nestjs/common';
import type { Clock, RedisClient } from '@/cache';
import { SystemClock } from '@/cache';
import { RateLimitStore } from '../core/rate-limit-store.interface';
import { RateLimitResult } from '../core/rate-limit-result.interface';
import { RateLimitConfigurationError } from '../errors/ratelimit-configuration.error';
import { RateLimiterConfig } from '../ratelimit.types';

/**
 * KEYS[1] = current window counter key
 * KEYS[2] = previous window counter key
 * ARGV[1] = limit
 * ARGV[2] = windowMs
 * ARGV[3] = elapsed ms into the current window
 *
 * Computes the same weighted-blend estimate `MemoryRateLimitStore` does,
 * but atomically server-side: the GET-then-INCR-then-PEXPIRE sequence
 * would otherwise race across concurrent requests hitting different
 * `apps/server` replicas — this is the entire reason a Redis-backed store
 * needs `RedisClient.eval` rather than plain `get`/`set`.
 */
const SLIDING_WINDOW_SCRIPT = `
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local elapsed = tonumber(ARGV[3])
local weight = 1 - (elapsed / windowMs)

local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local previous = tonumber(redis.call('GET', KEYS[2]) or '0')

local estimated = (previous * weight) + current + 1

if estimated > limit then
  return {0, current, previous}
end

local newCurrent = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], windowMs * 2)

return {1, newCurrent, previous}
`;

/**
 * KEYS[1] = bucket state key, storing `"<tokens>:<lastRefillAtMs>"` as a
 * single string (two Redis keys would need a second round trip or a
 * transaction to stay consistent; one key keeps it a single atomic GET+SET).
 * ARGV[1] = limit (bucket capacity), ARGV[2] = windowMs, ARGV[3] = now (ms)
 *
 * Mirrors `MemoryRateLimitStore.consumeTokenBucket` exactly — see its doc
 * comment. `tokens` is returned as a string since Redis's Lua→RESP
 * conversion truncates non-integer numbers to integers, which would lose
 * the fractional token count `remaining` needs.
 */
const TOKEN_BUCKET_SCRIPT = `
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local refillRate = limit / windowMs

local tokens = limit
local state = redis.call('GET', KEYS[1])

if state then
  local sep = string.find(state, ':')
  local storedTokens = tonumber(string.sub(state, 1, sep - 1))
  local lastRefillAt = tonumber(string.sub(state, sep + 1))
  local elapsed = now - lastRefillAt
  tokens = math.min(limit, storedTokens + (elapsed * refillRate))
end

local allowed = 0
if tokens >= 1 then
  allowed = 1
  tokens = tokens - 1
end

redis.call('SET', KEYS[1], tostring(tokens) .. ':' .. tostring(now))
redis.call('PEXPIRE', KEYS[1], windowMs * 2)

return {allowed, tostring(tokens)}
`;

/**
 * Correct across every `apps/server` replica, unlike `MemoryRateLimitStore`
 * — every replica shares the same Redis counters. Requires a `RedisClient`
 * with `eval` support (see `RateLimitModule`'s boot-time validation); a
 * client without it would force a non-atomic get-then-set fallback, which
 * defeats the entire point of a "correct under concurrency" rate limiter.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStore {
  constructor(
    private readonly client: RedisClient,
    private readonly keyPrefix = 'ratelimit',
    private readonly clock: Clock = new SystemClock(),
  ) {
    if (!this.client.eval) {
      throw new RateLimitConfigurationError(
        'Redis-backed rate limiting requires a RedisClient with eval() support ' +
          '(atomic Lua execution) — the injected client does not implement it.',
      );
    }
  }

  consume(key: string, config: RateLimiterConfig): Promise<RateLimitResult> {
    if (config.algorithm === 'token-bucket') {
      return this.consumeTokenBucket(key, config);
    }

    return this.consumeSlidingWindow(key, config);
  }

  private async consumeSlidingWindow(
    key: string,
    { limit, windowMs }: RateLimiterConfig,
  ): Promise<RateLimitResult> {
    const now = this.clock.now();
    const windowIndex = Math.floor(now / windowMs);
    const windowStart = windowIndex * windowMs;
    const elapsed = now - windowStart;

    const currentKey = `${this.keyPrefix}:${key}:${windowIndex}`;
    const previousKey = `${this.keyPrefix}:${key}:${windowIndex - 1}`;

    const raw = (await this.client.eval!(
      SLIDING_WINDOW_SCRIPT,
      2,
      [currentKey, previousKey],
      [String(limit), String(windowMs), String(elapsed)],
    )) as [number, number, number];

    const [allowedFlag, currentCount, previousCount] = raw;
    const allowed = allowedFlag === 1;
    const weight = 1 - elapsed / windowMs;

    const remaining = Math.max(
      0,
      Math.floor(limit - (previousCount * weight + currentCount)),
    );

    return {
      allowed,
      limit,
      remaining,
      resetAt: new Date(windowStart + windowMs),
    };
  }

  private async consumeTokenBucket(
    key: string,
    { limit, windowMs }: RateLimiterConfig,
  ): Promise<RateLimitResult> {
    const now = this.clock.now();
    const bucketKey = `${this.keyPrefix}:${key}:bucket`;

    const raw = (await this.client.eval!(
      TOKEN_BUCKET_SCRIPT,
      1,
      [bucketKey],
      [String(limit), String(windowMs), String(now)],
    )) as [number, string];

    const [allowedFlag, tokensRaw] = raw;
    const allowed = allowedFlag === 1;
    const tokens = Number(tokensRaw);
    const refillRatePerMs = limit / windowMs;
    const msUntilFull = (limit - tokens) / refillRatePerMs;

    return {
      allowed,
      limit,
      remaining: Math.floor(tokens),
      resetAt: new Date(now + msUntilFull),
    };
  }
}
