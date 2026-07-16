import { MultiLevelCache } from './multi-level.cache';
import { Cache } from '../core/cache.interface';
import { CacheStatistics } from '../core/cache-statistics';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';
import { MetadataAwareCache } from '../core/cache-metadata.interface';

function fakeCache<K, V>(overrides: Partial<Cache<K, V>> = {}): Cache<K, V> {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    has: jest.fn().mockResolvedValue(false),
    delete: jest.fn().mockResolvedValue(false),
    clear: jest.fn().mockResolvedValue(undefined),
    size: jest.fn().mockResolvedValue(0),
    keys: jest.fn().mockResolvedValue([]),
    values: jest.fn().mockResolvedValue([]),
    entries: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function fakeStatisticsCache<K, V>(
  statistics: CacheStatistics,
): StatisticsAwareCache<K, V> {
  return {
    ...fakeCache<K, V>(),
    statistics: jest.fn().mockResolvedValue(statistics),
    resetStatistics: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeMetadataAwareCache<K, V>(
  overrides: Partial<MetadataAwareCache<K, V>> = {},
): MetadataAwareCache<K, V> {
  return {
    ...fakeCache<K, V>(),
    getWithMetadata: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('MultiLevelCache', () => {
  describe('clear', () => {
    it('clears both levels when both succeed', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.clear()).resolves.toBeUndefined();
      expect(l1.clear).toHaveBeenCalledTimes(1);
      expect(l2.clear).toHaveBeenCalledTimes(1);
    });

    it('throws when only L2 fails, and still attempted L1', async () => {
      const l2Error = new Error('redis cache cannot clear all keys');
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>({
        clear: jest.fn().mockRejectedValue(l2Error),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.clear()).rejects.toMatchObject({
        errors: [l2Error],
      });
      expect(l1.clear).toHaveBeenCalledTimes(1);
    });

    it('throws when only L1 fails', async () => {
      const l1Error = new Error('l1 boom');
      const l1 = fakeCache<string, string>({
        clear: jest.fn().mockRejectedValue(l1Error),
      });
      const l2 = fakeCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.clear()).rejects.toMatchObject({
        errors: [l1Error],
      });
      expect(l2.clear).toHaveBeenCalledTimes(1);
    });

    it('aggregates both errors when both levels fail', async () => {
      const l1Error = new Error('l1 boom');
      const l2Error = new Error('l2 boom');
      const l1 = fakeCache<string, string>({
        clear: jest.fn().mockRejectedValue(l1Error),
      });
      const l2 = fakeCache<string, string>({
        clear: jest.fn().mockRejectedValue(l2Error),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.clear()).rejects.toMatchObject({
        errors: [l1Error, l2Error],
      });
    });
  });

  describe('statistics', () => {
    it('sums per-level counters, including errors, across both levels', async () => {
      const l1 = fakeStatisticsCache<string, string>({
        hits: 5,
        misses: 1,
        writes: 2,
        deletes: 0,
        evictions: 0,
        expirations: 0,
        errors: 0,
      });
      const l2 = fakeStatisticsCache<string, string>({
        hits: 1,
        misses: 3,
        writes: 2,
        deletes: 1,
        evictions: 0,
        expirations: 0,
        errors: 2,
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.statistics()).resolves.toEqual({
        hits: 6,
        misses: 4,
        writes: 4,
        deletes: 1,
        evictions: 0,
        expirations: 0,
        errors: 2,
      });
    });
  });

  describe('get', () => {
    it('returns the L1 value without touching L2 on an L1 hit', async () => {
      const l1 = fakeCache<string, string>({
        get: jest.fn().mockResolvedValue('l1-value'),
      });
      const l2 = fakeMetadataAwareCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.get('k')).resolves.toBe('l1-value');
      expect(l2.getWithMetadata).not.toHaveBeenCalled();
      expect(l2.get).not.toHaveBeenCalled();
    });

    it('promotes an L2 hit to L1 preserving its TTL when L2 is metadata-aware', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeMetadataAwareCache<string, string>({
        getWithMetadata: jest
          .fn()
          .mockResolvedValue({ value: 'l2-value', ttl: 5000 }),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.get('k')).resolves.toBe('l2-value');
      expect(l1.set).toHaveBeenCalledWith('k', 'l2-value', { ttl: 5000 });
    });

    it('promotes an L2 hit to L1 with no TTL when L2 is not metadata-aware', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>({
        get: jest.fn().mockResolvedValue('l2-value'),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.get('k')).resolves.toBe('l2-value');
      expect(l1.set).toHaveBeenCalledWith('k', 'l2-value');
    });

    it('returns undefined on a miss at both levels without writing to L1', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeMetadataAwareCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.get('k')).resolves.toBeUndefined();
      expect(l1.set).not.toHaveBeenCalled();
    });
  });

  describe('getWithMetadata', () => {
    it('returns the L1 entry directly when L1 is metadata-aware and hits', async () => {
      const l1 = fakeMetadataAwareCache<string, string>({
        getWithMetadata: jest
          .fn()
          .mockResolvedValue({ value: 'l1-value', ttl: 1000 }),
      });
      const l2 = fakeMetadataAwareCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.getWithMetadata('k')).resolves.toEqual({
        value: 'l1-value',
        ttl: 1000,
      });
      expect(l2.getWithMetadata).not.toHaveBeenCalled();
    });

    it('reports no ttl for an L1 hit when L1 is not metadata-aware', async () => {
      const l1 = fakeCache<string, string>({
        get: jest.fn().mockResolvedValue('l1-value'),
      });
      const l2 = fakeMetadataAwareCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.getWithMetadata('k')).resolves.toEqual({
        value: 'l1-value',
        ttl: undefined,
      });
    });

    it('promotes an L2 hit and preserves its TTL', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeMetadataAwareCache<string, string>({
        getWithMetadata: jest
          .fn()
          .mockResolvedValue({ value: 'l2-value', ttl: 2500 }),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.getWithMetadata('k')).resolves.toEqual({
        value: 'l2-value',
        ttl: 2500,
      });
      expect(l1.set).toHaveBeenCalledWith('k', 'l2-value', { ttl: 2500 });
    });

    it("is itself metadata-aware, so a MultiLevelCache nested as another one's L2 preserves TTL on promotion", async () => {
      const innerL1 = fakeCache<string, string>();
      const innerL2 = fakeMetadataAwareCache<string, string>({
        getWithMetadata: jest
          .fn()
          .mockResolvedValue({ value: 'deep-value', ttl: 9000 }),
      });
      const innerMultiLevel = new MultiLevelCache(innerL1, innerL2);

      const outerL1 = fakeCache<string, string>();
      const outerCache = new MultiLevelCache(outerL1, innerMultiLevel);

      await expect(outerCache.getWithMetadata('k')).resolves.toEqual({
        value: 'deep-value',
        ttl: 9000,
      });
      // The outer cache's L1 must have been promoted with the TTL that
      // originated all the way down at the innermost L2 — not dropped.
      expect(outerL1.set).toHaveBeenCalledWith('k', 'deep-value', {
        ttl: 9000,
      });
    });

    it('returns undefined on a miss at both levels', async () => {
      const l1 = fakeMetadataAwareCache<string, string>();
      const l2 = fakeMetadataAwareCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.getWithMetadata('k')).resolves.toBeUndefined();
    });
  });

  describe('set', () => {
    it('writes to both levels with the same options', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await cache.set('k', 'v', { ttl: 1000 });

      expect(l1.set).toHaveBeenCalledWith('k', 'v', { ttl: 1000 });
      expect(l2.set).toHaveBeenCalledWith('k', 'v', { ttl: 1000 });
    });
  });

  describe('delete', () => {
    it('deletes from both levels and returns true if either succeeded', async () => {
      const l1 = fakeCache<string, string>({
        delete: jest.fn().mockResolvedValue(false),
      });
      const l2 = fakeCache<string, string>({
        delete: jest.fn().mockResolvedValue(true),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.delete('k')).resolves.toBe(true);
      expect(l1.delete).toHaveBeenCalledWith('k', undefined);
      expect(l2.delete).toHaveBeenCalledWith('k', undefined);
    });

    it('returns false when neither level had the key', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.delete('k')).resolves.toBe(false);
    });
  });

  describe('has', () => {
    it('short-circuits on an L1 hit without checking L2', async () => {
      const l1 = fakeCache<string, string>({
        has: jest.fn().mockResolvedValue(true),
      });
      const l2 = fakeCache<string, string>();
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.has('k')).resolves.toBe(true);
      expect(l2.has).not.toHaveBeenCalled();
    });

    it('falls back to L2 on an L1 miss', async () => {
      const l1 = fakeCache<string, string>();
      const l2 = fakeCache<string, string>({
        has: jest.fn().mockResolvedValue(true),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.has('k')).resolves.toBe(true);
    });
  });

  describe('keys / entries / values / size', () => {
    it('unions keys from both levels, deduplicated', async () => {
      const l1 = fakeCache<string, string>({
        keys: jest.fn().mockResolvedValue(['a', 'b']),
      });
      const l2 = fakeCache<string, string>({
        keys: jest.fn().mockResolvedValue(['b', 'c']),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.keys()).resolves.toEqual(['a', 'b', 'c']);
      await expect(cache.size()).resolves.toBe(3);
    });

    it('silently treats a rejecting level as empty rather than failing keys()/size()', async () => {
      const l1 = fakeCache<string, string>({
        keys: jest.fn().mockResolvedValue(['a']),
      });
      const l2 = fakeCache<string, string>({
        keys: jest.fn().mockRejectedValue(new Error('not supported')),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.keys()).resolves.toEqual(['a']);
      await expect(cache.size()).resolves.toBe(1);
    });

    it('prefers the L1 value over L2 for a key present in both entries()', async () => {
      const l1 = fakeCache<string, string>({
        entries: jest.fn().mockResolvedValue([['k', 'fresh-l1']]),
      });
      const l2 = fakeCache<string, string>({
        entries: jest.fn().mockResolvedValue([['k', 'stale-l2']]),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.entries()).resolves.toEqual([['k', 'fresh-l1']]);
      await expect(cache.values()).resolves.toEqual(['fresh-l1']);
    });

    it('silently treats a rejecting level as empty rather than failing entries()/values()', async () => {
      const l1 = fakeCache<string, string>({
        entries: jest.fn().mockResolvedValue([['a', '1']]),
      });
      const l2 = fakeCache<string, string>({
        entries: jest.fn().mockRejectedValue(new Error('not supported')),
      });
      const cache = new MultiLevelCache(l1, l2);

      await expect(cache.entries()).resolves.toEqual([['a', '1']]);
      await expect(cache.values()).resolves.toEqual(['1']);
    });
  });
});
