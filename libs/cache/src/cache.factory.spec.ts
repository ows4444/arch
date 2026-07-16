import { CacheFactory } from './cache.factory';
import { FakeClock } from './clocks/fake.clock';
import { RedisClient } from './caches/redis.cache';
import { CacheSerializer } from './interfaces/cache-serializer.interface';

function fakeRedisClient(): jest.Mocked<RedisClient> {
  const store = new Map<string, string>();

  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => {
      const existed = store.delete(key);
      return Promise.resolve(existed ? 1 : 0);
    }),
    exists: jest.fn((key: string) => Promise.resolve(store.has(key))),
  };
}

describe('CacheFactory', () => {
  describe('memory', () => {
    it('builds a working MemoryCache that round-trips set/get/has/delete', async () => {
      const cache = CacheFactory.memory<string>({ capacity: 10 });

      await cache.set('key', 'value');

      expect(await cache.get('key')).toBe('value');
      expect(await cache.has('key')).toBe(true);
      expect(await cache.delete('key')).toBe(true);
      expect(await cache.get('key')).toBeUndefined();
    });

    it('defaults to the lru replacement policy, evicting the least-recently-used entry at capacity', async () => {
      const cache = CacheFactory.memory<string>({ capacity: 2 });

      await cache.set('a', '1');
      await cache.set('b', '2');
      // touch 'a' so 'b' becomes the least-recently-used entry
      await cache.get('a');
      await cache.set('c', '3');

      expect(await cache.has('a')).toBe(true);
      expect(await cache.has('b')).toBe(false);
      expect(await cache.has('c')).toBe(true);
    });

    it('threads an explicit clock through so TTL expiry follows the fake clock, not real time', async () => {
      const clock = new FakeClock(0);
      const cache = CacheFactory.memory<string>(
        { capacity: 10, ttl: 1000 },
        'lru',
        clock,
      );

      await cache.set('key', 'value');
      expect(await cache.get('key')).toBe('value');

      clock.advance(1001);

      expect(await cache.get('key')).toBeUndefined();
    });
  });

  describe('redis', () => {
    it('uses an explicitly supplied serializer for serialize/deserialize', async () => {
      const client = fakeRedisClient();
      const serialize = jest.fn(
        (value: unknown) => `custom:${JSON.stringify(value)}`,
      );
      const deserialize = jest.fn((raw: string): unknown =>
        JSON.parse(raw.replace('custom:', '')),
      );
      const serializer = {
        serialize,
        deserialize,
      } as unknown as CacheSerializer;

      const cache = CacheFactory.redis<string>(client, serializer);

      await cache.set('key', 'value');

      expect(serialize).toHaveBeenCalledWith('value');
      expect(client.set).toHaveBeenCalledWith(
        'cache:key',
        'custom:"value"',
        undefined,
      );

      await cache.get('key');

      expect(deserialize).toHaveBeenCalledWith('custom:"value"');
    });

    it('defaults to SafeJsonCacheSerializer when no serializer is supplied', async () => {
      const client = fakeRedisClient();
      const cache = CacheFactory.redis<Record<string, unknown>>(client);

      const circular: Record<string, unknown> = {};
      circular.self = circular;

      // SafeJsonCacheSerializer wraps native JSON.stringify failures in a
      // descriptive error rather than letting a raw TypeError escape.
      await expect(cache.set('key', circular)).rejects.toThrow(
        /Failed to serialize cache value/,
      );
    });

    it('round-trips a plain value with the default SafeJsonCacheSerializer', async () => {
      const client = fakeRedisClient();
      const cache = CacheFactory.redis<{ a: number }>(client);

      await cache.set('key', { a: 1 });

      expect(await cache.get('key')).toEqual({ a: 1 });
    });
  });

  describe('multiLevel', () => {
    it('composes two caches so a value set through the multi-level cache is retrievable', async () => {
      const l1 = CacheFactory.memory<string>({ capacity: 10 });
      const l2 = CacheFactory.memory<string>({ capacity: 10 });

      const multi = CacheFactory.multiLevel(l1, l2);

      await multi.set('key', 'value');

      expect(await multi.get('key')).toBe('value');
      expect(await l1.get('key')).toBe('value');
      expect(await l2.get('key')).toBe('value');
    });

    it('promotes an L2-only value into L1 on read', async () => {
      const l1 = CacheFactory.memory<string>({ capacity: 10 });
      const l2 = CacheFactory.memory<string>({ capacity: 10 });

      await l2.set('key', 'value');

      const multi = CacheFactory.multiLevel(l1, l2);

      expect(await multi.get('key')).toBe('value');
      expect(await l1.get('key')).toBe('value');
    });
  });
});
