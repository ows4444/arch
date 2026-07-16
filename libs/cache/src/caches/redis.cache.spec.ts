import { RedisCacheStore, RedisClient } from './redis.cache';

function fakeClient(overrides: Partial<RedisClient> = {}): RedisClient {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(0),
    exists: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

describe('RedisCacheStore', () => {
  it('reports a genuine miss as a miss, not an error', async () => {
    const client = fakeClient({ get: jest.fn().mockResolvedValue(null) });
    const store = new RedisCacheStore<string>(client);

    await expect(store.get('key')).resolves.toBeUndefined();

    const stats = await store.statistics();
    expect(stats.misses).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it('reports a corrupted/unparseable value as an error, not a miss', async () => {
    const client = fakeClient({
      get: jest.fn().mockResolvedValue('{not valid json'),
    });
    const store = new RedisCacheStore<string>(client);

    await expect(store.get('key')).resolves.toBeUndefined();

    const stats = await store.statistics();
    expect(stats.errors).toBe(1);
    expect(stats.misses).toBe(0);
  });

  it('reports a valid value as a hit', async () => {
    const client = fakeClient({
      get: jest.fn().mockResolvedValue(JSON.stringify('value')),
    });
    const store = new RedisCacheStore<string>(client);

    await expect(store.get('key')).resolves.toBe('value');

    const stats = await store.statistics();
    expect(stats.hits).toBe(1);
    expect(stats.errors).toBe(0);
  });

  it('resets the error counter along with the other stats', async () => {
    const client = fakeClient({
      get: jest.fn().mockResolvedValue('{not valid json'),
    });
    const store = new RedisCacheStore<string>(client);

    await store.get('key');
    await store.resetStatistics();

    const stats = await store.statistics();
    expect(stats.errors).toBe(0);
  });

  describe('unsupported bulk operations', () => {
    it('clear() rejects rather than throwing synchronously', () => {
      const store = new RedisCacheStore<string>(fakeClient());
      let result: Promise<void> | undefined;

      expect(() => {
        result = store.clear();
      }).not.toThrow();

      return expect(result).rejects.toThrow(/cannot clear all keys/);
    });

    it('is safe to call from within Promise.allSettled alongside other caches', async () => {
      const store = new RedisCacheStore<string>(fakeClient());

      const results = await Promise.allSettled([
        Promise.resolve(),
        store.clear(),
      ]);

      expect(results[0]).toMatchObject({ status: 'fulfilled' });
      expect(results[1]).toMatchObject({ status: 'rejected' });
    });

    it.each(['size', 'keys', 'values', 'entries'] as const)(
      '%s() rejects rather than throwing synchronously',
      (method) => {
        const store = new RedisCacheStore<string>(fakeClient());
        let result: Promise<unknown> | undefined;

        expect(() => {
          result = store[method]();
        }).not.toThrow();

        return expect(result).rejects.toThrow();
      },
    );
  });
});
