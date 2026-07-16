import { MultiLevelCache } from './multi-level.cache';
import { Cache } from '../core/cache.interface';
import { CacheStatistics } from '../core/cache-statistics';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';

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
});
