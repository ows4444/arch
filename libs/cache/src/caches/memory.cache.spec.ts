import { MemoryCache } from './memory.cache';
import { MemoryCacheStorage } from '../storage/memory-cache.storage';
import { LruPolicy } from '../policies/lru.policy';
import { FakeClock } from '../clocks/fake.clock';
import { CacheEntry } from '../core/cache-entry';
import { CachePlugin } from '../interfaces/cache-plugin.interface';

function createCache<V>(
  overrides: {
    capacity?: number;
    slidingExpiration?: boolean;
    cloneValues?: boolean;
    plugins?: readonly CachePlugin<string, V>[];
  } = {},
) {
  const clock = new FakeClock(0);
  const cache = new MemoryCache<string, V>(
    new MemoryCacheStorage<string, CacheEntry<V>>(),
    new LruPolicy<string>(),
    {
      capacity: overrides.capacity ?? 10,
      ...(overrides.slidingExpiration !== undefined && {
        slidingExpiration: overrides.slidingExpiration,
      }),
      ...(overrides.cloneValues !== undefined && {
        cloneValues: overrides.cloneValues,
      }),
    },
    clock,
    overrides.plugins ?? [],
  );

  return { cache, clock };
}

describe('MemoryCache', () => {
  it('does not deadlock when set() triggers an eviction', async () => {
    const { cache } = createCache<string>({ capacity: 1 });

    await cache.set('a', 'first');
    await cache.set('b', 'second');

    await expect(cache.get('a')).resolves.toBeUndefined();
    await expect(cache.get('b')).resolves.toBe('second');
  });

  it('does not deadlock when a get() touch races a concurrent set()', async () => {
    const { cache } = createCache<string>({ slidingExpiration: true });

    await cache.set('key', 'v1');

    await Promise.all([cache.get('key'), cache.set('key', 'v2')]);

    await expect(cache.get('key')).resolves.toBe('v2');
  });

  it('serializes a concurrent touching get() and delete() on the same key', async () => {
    const { cache } = createCache<string>({ slidingExpiration: true });

    await cache.set('key', 'v1');

    const [got, deleted] = await Promise.all([
      cache.get('key'),
      cache.delete('key'),
    ]);

    expect(['v1', undefined]).toContain(got);
    expect(deleted).toBe(true);
    await expect(cache.get('key')).resolves.toBeUndefined();
  });

  it('fires afterDelete plugins for an explicit delete()', async () => {
    const afterDelete = jest.fn();
    const { cache } = createCache<string>({ plugins: [{ afterDelete }] });

    await cache.set('key', 'v1');
    await cache.delete('key');

    expect(afterDelete).toHaveBeenCalledWith('key');
  });

  it('does not fire delete plugins for capacity eviction (documented trade-off)', async () => {
    const afterDelete = jest.fn();
    const { cache } = createCache<string>({
      capacity: 1,
      plugins: [{ afterDelete }],
    });

    await cache.set('a', 'first');
    await cache.set('b', 'second');

    expect(afterDelete).not.toHaveBeenCalled();
  });

  it('fires beforeGet/afterGet plugins for getWithMetadata, matching get()', async () => {
    const beforeGet = jest.fn();
    const afterGet = jest.fn();
    const { cache } = createCache<string>({
      plugins: [{ beforeGet, afterGet }],
    });

    await cache.set('key', 'v1');
    await cache.getWithMetadata('key');

    expect(beforeGet).toHaveBeenCalledWith('key');
    expect(afterGet).toHaveBeenCalledWith('key', 'v1');
  });

  it('getWithMetadata reports a miss and fires afterGet(undefined) for a missing key', async () => {
    const afterGet = jest.fn();
    const { cache } = createCache<string>({ plugins: [{ afterGet }] });

    await expect(cache.getWithMetadata('missing')).resolves.toBeUndefined();
    expect(afterGet).toHaveBeenCalledWith('missing', undefined);
  });

  it('applies sliding expiration on touch reads via get()', async () => {
    const { cache, clock } = createCache<string>({ slidingExpiration: true });

    await cache.set('key', 'v1', { ttl: 100 });
    clock.advance(60);
    await cache.get('key');
    clock.advance(60);

    await expect(cache.get('key')).resolves.toBe('v1');
  });

  describe('reference semantics', () => {
    interface Mutable {
      count: number;
    }

    it('by default (cloneValues off) hands out the same object reference on every get()', async () => {
      const { cache } = createCache<Mutable>();
      const original = { count: 1 };

      await cache.set('key', original);
      const first = await cache.get('key');
      const second = await cache.get('key');

      expect(first).toBe(original);
      expect(second).toBe(original);
    });

    it('by default (cloneValues off) a mutation on a returned value corrupts the cached entry', async () => {
      const { cache } = createCache<Mutable>();

      await cache.set('key', { count: 1 });
      const got = await cache.get('key');
      got!.count = 999;

      await expect(cache.get('key')).resolves.toEqual({ count: 999 });
    });

    it("with cloneValues on, set() isolates the cache from the caller's object", async () => {
      const { cache } = createCache<Mutable>({ cloneValues: true });
      const original = { count: 1 };

      await cache.set('key', original);
      original.count = 999;

      await expect(cache.get('key')).resolves.toEqual({ count: 1 });
    });

    it('with cloneValues on, mutating a get() result does not affect the cached entry', async () => {
      const { cache } = createCache<Mutable>({ cloneValues: true });

      await cache.set('key', { count: 1 });
      const got = await cache.get('key');
      got!.count = 999;

      await expect(cache.get('key')).resolves.toEqual({ count: 1 });
    });

    it('with cloneValues on, getWithMetadata() also returns an isolated copy', async () => {
      const { cache } = createCache<Mutable>({ cloneValues: true });

      await cache.set('key', { count: 1 });
      const entry = await cache.getWithMetadata('key');
      entry!.value.count = 999;

      await expect(cache.get('key')).resolves.toEqual({ count: 1 });
    });

    it('with cloneValues on, values() and entries() return isolated copies', async () => {
      const { cache } = createCache<Mutable>({ cloneValues: true });

      await cache.set('key', { count: 1 });
      const [value] = await cache.values();
      value!.count = 999;

      const [firstEntry] = await cache.entries();
      const entryValue = firstEntry![1];
      entryValue.count = 500;

      await expect(cache.get('key')).resolves.toEqual({ count: 1 });
    });
  });
});
