import { CacheLoadOptions, CacheManager } from './cache-manager';
import { CacheRegistry } from './cache-registry';
import { CacheStatistics } from './core/cache-statistics';
import { isStatisticsAwareCache } from './core/is-statistics-aware-cache';
import { SingleFlight } from './core/single-flight';
import { StatisticsAwareCache } from './core/statistics-aware-cache.interface';

export class DefaultCacheManager implements CacheManager {
  constructor(private readonly registry: CacheRegistry) {}
  private readonly singleFlight = new SingleFlight<string>();

  private statisticsCache(
    cache: string,
  ): StatisticsAwareCache<string, unknown> | undefined {
    const instance = this.registry.get(cache);

    if (isStatisticsAwareCache(instance)) {
      return instance;
    }

    return undefined;
  }

  async statistics(
    cache: string,
  ): Promise<Readonly<CacheStatistics> | undefined> {
    return this.statisticsCache(cache)?.statistics();
  }

  async resetStatistics(cache: string): Promise<boolean> {
    const statisticsCache = this.statisticsCache(cache);

    if (!statisticsCache) {
      return false;
    }

    await statisticsCache.resetStatistics();

    return true;
  }

  async get<T>(cache: string, key: string): Promise<T | undefined> {
    return this.registry.get<T>(cache).get(key);
  }

  async getOrLoad<T>(
    cache: string,
    key: string,
    loader: () => Promise<T>,
    options?: CacheLoadOptions,
  ): Promise<T> {
    const cached = await this.get<T>(cache, key);

    if (cached !== undefined) {
      return cached;
    }

    return this.singleFlight.do(JSON.stringify([cache, key]), async () => {
      const cached = await this.get<T>(cache, key);

      if (cached !== undefined) {
        return cached;
      }

      const value = await loader();

      if (options?.cache?.(value) ?? true) {
        await this.set(cache, key, value, options?.ttl);
      }

      return value;
    });
  }

  async set<T>(
    cache: string,
    key: string,
    value: T,
    ttl?: number,
  ): Promise<void> {
    await this.registry
      .get<T>(cache)
      .set(key, value, ttl !== undefined ? { ttl } : {});
  }

  async delete(cache: string, key: string): Promise<void> {
    await this.registry.get(cache).delete(key);
  }

  async clear(cache?: string): Promise<void> {
    if (cache) {
      await this.registry.get(cache).clear();
      return;
    }

    await Promise.all(
      this.registry.names().map((name) => this.registry.get(name).clear()),
    );
  }
}
