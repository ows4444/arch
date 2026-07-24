import Redis from 'ioredis';
import type { RedisClient } from '@/cache';
import { RateLimiterService } from './rate-limiter.service';
import { RedisRateLimitStore } from '../stores/redis-rate-limit.store';
import type { RateLimitModuleOptions } from '../ratelimit.types';
import type { RateLimitMetrics } from '../core/rate-limit-metrics.interface';
import type { RateLimiterRuleResolver } from '../core/rate-limiter-rule-resolver.interface';

/**
 * Same regression as `rate-limiter.service.spec.ts`'s
 * limiterName/key-collision test (libs/ratelimit/LOOP.md Loop 009's real,
 * concretely-exploitable fix: an unauthenticated caller could pick a
 * colon-bearing IPv6-shaped key to collide two logically distinct
 * limiter/key pairs into one shared Redis counter), but against a real
 * Redis instance running the actual Lua script instead of a mocked
 * `RedisClient`. The unit spec only proves the *string* handed to the
 * store's `consume()` is correctly escaped — it can't prove that string
 * actually produces two independent counters once it reaches Redis's real
 * key space, which is the thing an attacker actually cares about.
 *
 * Requires `make compose-up`'s Redis (port 6380 by default). Skipped by
 * default so `npm test` stays hermetic; run explicitly with:
 *   RUN_REDIS_INTEGRATION_TESTS=1 npx jest rate-limiter.redis
 */
const describeIfRedis =
  process.env.RUN_REDIS_INTEGRATION_TESTS === '1' ? describe : describe.skip;

class IoRedisTestAdapter implements RedisClient {
  constructor(private readonly client: Redis) {}

  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds === undefined) {
      await this.client.set(key, value);
      return;
    }
    await this.client.set(key, value, 'EX', ttlSeconds);
  }

  del(key: string): Promise<number> {
    return this.client.del(key);
  }

  exists(key: string): Promise<number> {
    return this.client.exists(key);
  }

  eval(
    script: string,
    numKeys: number,
    keys: string[],
    args: string[],
  ): Promise<unknown> {
    return this.client.eval(script, numKeys, ...keys, ...args);
  }
}

describeIfRedis(
  'RateLimiterService — key collision fix against real Redis',
  () => {
    let redis: Redis;
    let service: RateLimiterService;

    beforeAll(() => {
      redis = new Redis({
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6380),
      });
    });

    afterAll(() => {
      redis.disconnect();
    });

    beforeEach(async () => {
      await redis.flushdb();

      const adapter = new IoRedisTestAdapter(redis);
      const store = new RedisRateLimitStore(adapter, 'rl-test');
      const options: RateLimitModuleOptions = {
        limiters: {
          'a:b': { limit: 1, windowMs: 60_000 },
          a: { limit: 1, windowMs: 60_000 },
        },
        store: { type: 'redis', client: adapter },
      };
      const metrics: RateLimitMetrics = {
        requestAllowed: () => undefined,
        requestRejected: () => undefined,
        storeFailure: () => undefined,
      };
      const resolver: RateLimiterRuleResolver = {
        resolve: (limiterName: string) =>
          Promise.resolve(options.limiters[limiterName]),
      };

      service = new RateLimiterService(options, store, metrics, resolver);
    });

    it('keeps limiterName="a:b"/key="c" and limiterName="a"/key="b:c" as independent counters in real Redis', async () => {
      // Without the Loop 009 escaping fix, both calls below would resolve to
      // the same underlying Redis key ("rl-test:a:b:c:<window>") and the
      // second call would incorrectly see the first's consumption, getting
      // rejected even though each limiter has its own separate limit of 1.
      const first = await service.consume('a:b', 'c');
      const second = await service.consume('a', 'b:c');

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);

      // Each limiter's single slot is now used — a second call to either
      // must be rejected, proving the counters are real and independent
      // rather than both silently no-ops.
      const firstAgain = await service.consume('a:b', 'c');
      const secondAgain = await service.consume('a', 'b:c');

      expect(firstAgain.allowed).toBe(false);
      expect(secondAgain.allowed).toBe(false);
    });
  },
);
