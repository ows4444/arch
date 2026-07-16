import { Logger } from '@nestjs/common';
import { CacheStatistics } from '../core/cache-statistics';
import { CacheValue } from '../core/cache-entry-value.interface';
import {
  Cache,
  CacheDeleteOptions,
  CacheGetOptions,
  CacheSetOptions,
} from '../core/cache.interface';
import { isMetadataAwareCache } from '../core/is-metadata-aware-cache';
import { isStatisticsAwareCache } from '../core/is-statistics-aware-cache';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';
import { MetadataAwareCache } from '../core/cache-metadata.interface';

export class MultiLevelCache<K, V>
  implements StatisticsAwareCache<K, V>, MetadataAwareCache<K, V>
{
  private readonly logger = new Logger(MultiLevelCache.name);

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
      errors: (l1?.errors ?? 0) + (l2?.errors ?? 0),
    };
  }

  async resetStatistics(): Promise<void> {
    await Promise.all([
      isStatisticsAwareCache(this.l1) ? this.l1.resetStatistics() : undefined,
      isStatisticsAwareCache(this.l2) ? this.l2.resetStatistics() : undefined,
    ]);
  }

  private async safeKeys(
    cache: Cache<K, V>,
    level: 'l1' | 'l2',
  ): Promise<readonly K[]> {
    try {
      return await cache.keys();
    } catch (error) {
      this.logger.debug(
        `${level} cache does not support keys() enumeration; size()/keys() will only reflect the other level. (${error instanceof Error ? error.message : String(error)})`,
      );
      return [];
    }
  }

  private async safeEntries(
    cache: Cache<K, V>,
    level: 'l1' | 'l2',
  ): Promise<readonly (readonly [K, V])[]> {
    try {
      return await cache.entries();
    } catch (error) {
      this.logger.debug(
        `${level} cache does not support entries() enumeration; entries()/values() will only reflect the other level. (${error instanceof Error ? error.message : String(error)})`,
      );
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

  /**
   * Metadata-aware equivalent of `get()`. Implementing this (rather than
   * leaving `MultiLevelCache` non-metadata-aware) matters when a
   * multi-level cache is itself nested as another multi-level cache's L2:
   * without it, `isMetadataAwareCache(l2)` would be false for the outer
   * cache and promotion would fall back to the no-TTL path, letting a
   * promoted value outlive the TTL it had in the inner L2.
   */
  async getWithMetadata(key: K): Promise<CacheValue<V> | undefined> {
    const l1Entry = isMetadataAwareCache(this.l1)
      ? await this.l1.getWithMetadata(key)
      : await this.l1
          .get(key)
          .then((value) =>
            value === undefined ? undefined : { value, ttl: undefined },
          );

    if (l1Entry) {
      return l1Entry;
    }

    if (isMetadataAwareCache(this.l2)) {
      const l2Entry = await this.l2.getWithMetadata(key);

      if (!l2Entry) {
        return undefined;
      }

      await this.l1.set(key, l2Entry.value, this.promoteOptions(l2Entry.ttl));

      return l2Entry;
    }

    const fallback = await this.l2.get(key);

    if (fallback === undefined) {
      return undefined;
    }

    await this.l1.set(key, fallback);

    return { value: fallback, ttl: undefined };
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
    const results = await Promise.allSettled([
      this.l1.clear(),
      this.l2.clear(),
    ]);

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure): unknown => failure.reason),
        'Failed to clear one or more cache levels.',
      );
    }
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

    for (const key of await this.safeKeys(this.l1, 'l1')) {
      keys.add(key);
    }

    for (const key of await this.safeKeys(this.l2, 'l2')) {
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

    for (const [key, value] of await this.safeEntries(this.l2, 'l2')) {
      result.set(key, value);
    }

    for (const [key, value] of await this.safeEntries(this.l1, 'l1')) {
      result.set(key, value);
    }

    return [...result.entries()];
  }
}
