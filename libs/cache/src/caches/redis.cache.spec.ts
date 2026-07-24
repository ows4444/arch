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

  describe('scoped SCAN+UNLINK when the client supports it', () => {
    function scanningClient(
      entries: Record<string, string>,
      overrides: Partial<RedisClient> = {},
    ): RedisClient {
      const store = new Map(Object.entries(entries));

      return fakeClient({
        get: jest.fn((key: string) =>
          Promise.resolve(store.has(key) ? (store.get(key) ?? null) : null),
        ),
        scan: jest.fn((cursor: string) => {
          const allKeys = [...store.keys()];

          if (cursor === '0') {
            // Split into two SCAN batches to exercise cursor pagination.
            const mid = Math.ceil(allKeys.length / 2);
            return Promise.resolve([
              allKeys.length > 1 ? '1' : '0',
              allKeys.slice(0, mid),
            ] as const);
          }

          const mid = Math.ceil(allKeys.length / 2);
          return Promise.resolve(['0', allKeys.slice(mid)] as const);
        }),
        unlink: jest.fn((...keys: string[]) => {
          for (const key of keys) {
            store.delete(key);
          }
          return Promise.resolve(keys.length);
        }),
        ...overrides,
      });
    }

    it("keys() returns bare keys scoped to this cache's namespace, paginating across cursors", async () => {
      const client = scanningClient({
        'cache:a': JSON.stringify('1'),
        'cache:b': JSON.stringify('2'),
      });
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      const keys = await store.keys();

      expect([...keys].sort()).toEqual(['a', 'b']);
    });

    it('values() and entries() resolve via keys() + get()', async () => {
      const client = scanningClient({
        'cache:a': JSON.stringify('1'),
        'cache:b': JSON.stringify('2'),
      });
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      await expect(store.values()).resolves.toEqual(
        expect.arrayContaining(['1', '2']),
      );
      await expect(store.entries()).resolves.toEqual(
        expect.arrayContaining([
          ['a', '1'],
          ['b', '2'],
        ]),
      );
    });

    it('values()/entries() do not inflate hit/miss statistics or fire get plugins', async () => {
      const client = scanningClient({
        'cache:a': JSON.stringify('1'),
        'cache:b': JSON.stringify('2'),
      });
      const plugin = {
        beforeGet: jest.fn(),
        afterGet: jest.fn(),
      };
      const store = new RedisCacheStore<string>(
        client,
        undefined,
        'cache',
        undefined,
        [plugin],
      );

      await store.values();
      await store.entries();

      const stats = await store.statistics();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.errors).toBe(0);
      expect(plugin.beforeGet).not.toHaveBeenCalled();
      expect(plugin.afterGet).not.toHaveBeenCalled();

      // A real get() still records stats/plugins as before.
      await store.get('a');
      const statsAfterRealGet = await store.statistics();
      expect(statsAfterRealGet.hits).toBe(1);
      expect(plugin.beforeGet).toHaveBeenCalledTimes(1);
      expect(plugin.afterGet).toHaveBeenCalledTimes(1);
    });

    it('size() reflects the number of keys under this namespace', async () => {
      const client = scanningClient({
        'cache:a': JSON.stringify('1'),
        'cache:b': JSON.stringify('2'),
        'cache:c': JSON.stringify('3'),
      });
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      await expect(store.size()).resolves.toBe(3);
    });

    it('clear() unlinks only the keys under this namespace', async () => {
      const client = scanningClient({
        'cache:a': JSON.stringify('1'),
        'cache:b': JSON.stringify('2'),
      });
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      await store.clear();

      expect(client.unlink).toHaveBeenCalledWith('cache:a', 'cache:b');
    });

    it('clear() does not call unlink when there is nothing to delete', async () => {
      const client = scanningClient({});
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      await store.clear();

      expect(client.unlink).not.toHaveBeenCalled();
    });

    it('still rejects clear() when scan is present but unlink is not', () => {
      const client = scanningClient({ 'cache:a': JSON.stringify('1') });
      delete (client as { unlink?: unknown }).unlink;
      const store = new RedisCacheStore<string>(client, undefined, 'cache');

      return expect(store.clear()).rejects.toThrow(/scan\/unlink/);
    });
  });
});
