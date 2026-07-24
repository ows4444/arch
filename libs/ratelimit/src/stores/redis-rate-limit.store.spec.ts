import { FakeClock } from '@/cache';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { RateLimitConfigurationError } from '../errors/ratelimit-configuration.error';

describe('RedisRateLimitStore', () => {
  function client(evalResult: unknown) {
    return {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      eval: jest.fn().mockResolvedValue(evalResult),
    };
  }

  it('throws at construction if the client has no eval support', () => {
    const bareClient = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
    };

    expect(() => new RedisRateLimitStore(bareClient as never)).toThrow(
      RateLimitConfigurationError,
    );
  });

  it('passes the current/previous window keys and elapsed time to the Lua script', async () => {
    const redis = client([1, 1, 0]);
    const clock = new FakeClock(1500);
    const store = new RedisRateLimitStore(redis, 'rl', clock);

    await store.consume('login:1.2.3.4', { limit: 5, windowMs: 1000 });

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      ['rl:login:1.2.3.4:1', 'rl:login:1.2.3.4:0'],
      ['5', '1000', '500'],
    );
  });

  it('reports allowed=true when the script returns 1', async () => {
    const redis = client([1, 3, 2]);
    const store = new RedisRateLimitStore(redis, 'rl', new FakeClock(0));

    const result = await store.consume('key-1', { limit: 10, windowMs: 1000 });

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(10);
  });

  it('reports allowed=false when the script returns 0', async () => {
    const redis = client([0, 10, 5]);
    const store = new RedisRateLimitStore(redis, 'rl', new FakeClock(0));

    const result = await store.consume('key-1', { limit: 10, windowMs: 1000 });

    expect(result.allowed).toBe(false);
  });

  it('computes resetAt as the end of the current fixed window', async () => {
    const redis = client([1, 1, 0]);
    const store = new RedisRateLimitStore(redis, 'rl', new FakeClock(1500));

    const result = await store.consume('key-1', { limit: 10, windowMs: 1000 });

    expect(result.resetAt.getTime()).toBe(2000);
  });

  describe('token-bucket algorithm', () => {
    it('uses a single bucket-state key and passes limit/windowMs/now to the script', async () => {
      const redis = client([1, '4']);
      const clock = new FakeClock(1500);
      const store = new RedisRateLimitStore(redis, 'rl', clock);

      await store.consume('login:1.2.3.4', {
        limit: 5,
        windowMs: 1000,
        algorithm: 'token-bucket',
      });

      expect(redis.eval).toHaveBeenCalledWith(
        expect.any(String),
        1,
        ['rl:login:1.2.3.4:bucket'],
        ['5', '1000', '1500'],
      );
    });

    it('reports allowed=true and parses the fractional token count when the script allows', async () => {
      const redis = client([1, '3.5']);
      const store = new RedisRateLimitStore(redis, 'rl', new FakeClock(0));

      const result = await store.consume('key-1', {
        limit: 5,
        windowMs: 1000,
        algorithm: 'token-bucket',
      });

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3);
    });

    it('reports allowed=false when the script rejects', async () => {
      const redis = client([0, '0.2']);
      const store = new RedisRateLimitStore(redis, 'rl', new FakeClock(0));

      const result = await store.consume('key-1', {
        limit: 5,
        windowMs: 1000,
        algorithm: 'token-bucket',
      });

      expect(result.allowed).toBe(false);
    });
  });
});
