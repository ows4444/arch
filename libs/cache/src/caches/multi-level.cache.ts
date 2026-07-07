import { CacheStatistics } from '../core/cache-statistics';
import {
  Cache,
  CacheDeleteOptions,
  CacheGetOptions,
  CacheSetOptions,
} from '../core/cache.interface';
import { isMetadataAwareCache } from '../core/is-metadata-aware-cache';
import { isStatisticsAwareCache } from '../core/is-statistics-aware-cache';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';

export class MultiLevelCache<K, V> implements StatisticsAwareCache<K, V> {
  constructor(
    private readonly l1: Cache<K, V>,
    private readonly l2: Cache<K, V>,
  ) {}

  async statistics(): Promise<Readonly<CacheStatistics>> {
    const l1 = await (isStatisticsAwareCache(this.l1)
      ? this.l1.statistics()
      : undefined);
    const l2 = await (isStatisticsAwareCache(this.l2)
      ? this.l2.statistics()
      : undefined);

    return {
      hits: (l1?.hits ?? 0) + (l2?.hits ?? 0),
      misses: (l1?.misses ?? 0) + (l2?.misses ?? 0),
      writes: (l1?.writes ?? 0) + (l2?.writes ?? 0),
      deletes: (l1?.deletes ?? 0) + (l2?.deletes ?? 0),
      evictions: (l1?.evictions ?? 0) + (l2?.evictions ?? 0),
      expirations: (l1?.expirations ?? 0) + (l2?.expirations ?? 0),
    };
  }

  async resetStatistics(): Promise<void> {
    await Promise.all([
      isStatisticsAwareCache(this.l1) ? this.l1.resetStatistics() : undefined,
      isStatisticsAwareCache(this.l2) ? this.l2.resetStatistics() : undefined,
    ]);
  }

  private async safeKeys(cache: Cache<K, V>): Promise<readonly K[]> {
    try {
      return await cache.keys();
    } catch {
      return [];
    }
  }

  private async safeEntries(
    cache: Cache<K, V>,
  ): Promise<readonly (readonly [K, V])[]> {
    try {
      return await cache.entries();
    } catch {
      return [];
    }
  }

  private promoteOptions(ttl?: number): CacheSetOptions | undefined {
    if (ttl === undefined) {
      return undefined;
    }

    return { ttl };
  }

  async get(key: K, options?: CacheGetOptions): Promise<V | undefined> {
    const value = await this.l1.get(key, options);

    if (value !== undefined) {
      return value;
    }

    if (isMetadataAwareCache(this.l2)) {
      const entry = await this.l2.getWithMetadata(key);

      if (entry) {
        await this.l1.set(key, entry.value, this.promoteOptions(entry.ttl));

        return entry.value;
      }

      return undefined;
    }

    const fallback = await this.l2.get(key, options);

    if (fallback !== undefined) {
      await this.l1.set(key, fallback);
    }

    return fallback;
  }

  async set(key: K, value: V, options?: CacheSetOptions): Promise<void> {
    await Promise.all([
      this.l1.set(key, value, options),
      this.l2.set(key, value, options),
    ]);
  }

  async delete(key: K, options?: CacheDeleteOptions): Promise<boolean> {
    const [l1Deleted, l2Deleted] = await Promise.all([
      this.l1.delete(key, options),
      this.l2.delete(key, options),
    ]);

    return l1Deleted || l2Deleted;
  }

  async clear(): Promise<void> {
    await Promise.all([this.l1.clear(), this.l2.clear()]);
  }

  async has(key: K): Promise<boolean> {
    if (await this.l1.has(key)) {
      return true;
    }

    return this.l2.has(key);
  }

  async size(): Promise<number> {
    return (await this.keys()).length;
  }

  async keys(): Promise<readonly K[]> {
    const keys = new Set<K>();

    for (const key of await this.safeKeys(this.l1)) {
      keys.add(key);
    }

    for (const key of await this.safeKeys(this.l2)) {
      keys.add(key);
    }

    return [...keys];
  }

  async values(): Promise<readonly V[]> {
    const entries = await this.entries();

    return entries.map(([, value]) => value);
  }

  async entries(): Promise<readonly (readonly [K, V])[]> {
    const result = new Map<K, V>();

    for (const [key, value] of await this.safeEntries(this.l2)) {
      result.set(key, value);
    }

    for (const [key, value] of await this.safeEntries(this.l1)) {
      result.set(key, value);
    }

    return [...result.entries()];
  }
}
