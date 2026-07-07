import {
  Cache,
  CacheGetOptions,
  CacheSetOptions,
} from '../core/cache.interface';
import { CacheEntry } from '../core/cache-entry';
import { CacheStorage } from '../core/cache-storage.interface';
import { ReplacementPolicy } from '../policies/replacement-policy.interface';
import { Clock } from '../interfaces/clock.interface';
import {
  CachePlugin,
  CachePluginErrorHandler,
  defaultPluginErrorHandler,
} from '../interfaces/cache-plugin.interface';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';
import { CacheStatistics } from '../core/cache-statistics';
import { CacheValue } from '../core/cache-entry-value.interface';

export interface MemoryCacheOptions {
  capacity: number;
  ttl?: number;
  slidingExpiration?: boolean;

  cleanupInterval?: number;
}

export class MemoryCache<K, V> implements StatisticsAwareCache<K, V> {
  private cleanupCounter = 0;

  constructor(
    private readonly store: CacheStorage<K, CacheEntry<V>>,
    private readonly policy: ReplacementPolicy<K>,
    private readonly options: MemoryCacheOptions,
    private readonly clock: Clock,
    private readonly plugins: readonly CachePlugin<K, V>[] = [],
    private readonly pluginErrorHandler?: CachePluginErrorHandler,
  ) {}

  private async tryCleanup(): Promise<void> {
    if (++this.cleanupCounter < (this.options.cleanupInterval ?? 100)) {
      return;
    }

    this.cleanupCounter = 0;
    await this.purgeExpired();
  }

  private readonly stats: CacheStatistics = {
    hits: 0,
    misses: 0,
    writes: 0,
    deletes: 0,
    evictions: 0,
    expirations: 0,
  };

  private async runPlugins(
    callback: (plugin: CachePlugin<K, V>) => Promise<void> | void,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await callback(plugin);
      } catch (error) {
        (this.pluginErrorHandler ?? defaultPluginErrorHandler)(error, plugin);
      }
    }
  }

  private async purgeExpired(): Promise<void> {
    for (const [key, entry] of await this.store.entries()) {
      if (!this.isExpired(entry)) {
        continue;
      }

      await this.deleteExpired(key);
    }
  }

  private async deleteExpired(key: K): Promise<void> {
    this.stats.expirations++;
    await this.delete(key);
  }

  private isExpired(entry: CacheEntry<V>): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= this.clock.now();
  }

  async getWithMetadata(key: K): Promise<CacheValue<V> | undefined> {
    const entry = await this.store.get(key);

    if (!entry) {
      return undefined;
    }

    if (this.isExpired(entry)) {
      await this.deleteExpired(key);
      return undefined;
    }

    return {
      value: entry.value,
      ttl:
        entry.expiresAt === undefined
          ? undefined
          : Math.max(0, entry.expiresAt - this.clock.now()),
    };
  }

  async get(key: K, options?: CacheGetOptions): Promise<V | undefined> {
    await this.tryCleanup();

    await this.runPlugins((plugin) => plugin.beforeGet?.(key));

    const entry = await this.store.get(key);

    if (!entry) {
      this.stats.misses++;
      await this.runPlugins((plugin) => plugin.afterGet?.(key, undefined));
      return undefined;
    }

    if (this.isExpired(entry)) {
      this.stats.misses++;
      await this.deleteExpired(key);

      await this.runPlugins((plugin) => plugin.afterGet?.(key, undefined));

      return undefined;
    }

    if (options?.touch === false) {
      await this.runPlugins((plugin) => plugin.afterGet?.(key, entry.value));

      return entry.value;
    }

    const ttl = this.options.ttl;

    const updated: CacheEntry<V> = {
      ...entry,
      accessedAt: this.clock.now(),
      accessCount: entry.accessCount + 1,
      expiresAt:
        this.options.slidingExpiration && ttl !== undefined
          ? this.clock.now() + ttl
          : entry.expiresAt,
    };

    await this.store.set(key, updated);

    this.policy.onGet(key);

    this.stats.hits++;

    await this.runPlugins((plugin) => plugin.afterGet?.(key, updated.value));

    return updated.value;
  }

  async set(key: K, value: V, options?: CacheSetOptions): Promise<void> {
    await this.runPlugins((plugin) => plugin.beforeSet?.(key, value));

    await this.tryCleanup();
    let entry = await this.store.get(key);

    const ttl = options?.ttl ?? this.options.ttl;

    const now = this.clock.now();

    const expiresAt = ttl === undefined ? undefined : now + ttl;

    if (entry) {
      const updated: CacheEntry<V> = {
        ...entry,
        value,
        updatedAt: now,
        accessedAt: now,
        expiresAt,
      };

      this.policy.onSet(key);

      await this.store.set(key, updated);

      this.stats.writes++;

      await this.runPlugins((plugin) => plugin.afterSet?.(key, value));

      return;
    }

    if (!entry && (await this.store.size()) >= this.options.capacity) {
      const victim = this.policy.evict();

      if (victim !== undefined) {
        const deleted = await this.delete(victim);

        if (deleted) {
          this.stats.evictions++;
        }
      }
    }

    entry = {
      value,
      createdAt: now,
      updatedAt: now,
      accessedAt: now,
      accessCount: 0,
      expiresAt,
    };

    await this.store.set(key, entry);

    this.stats.writes++;

    this.policy.onSet(key);

    await this.runPlugins((plugin) => plugin.afterSet?.(key, value));
  }

  async delete(key: K): Promise<boolean> {
    await this.runPlugins((plugin) => plugin.beforeDelete?.(key));

    this.policy.onDelete(key);

    const deleted = await this.store.delete(key);

    if (deleted) {
      this.stats.deletes++;
      await this.runPlugins((plugin) => plugin.afterDelete?.(key));
    }

    return deleted;
  }

  async has(key: K): Promise<boolean> {
    const entry = await this.store.get(key);

    if (!entry) {
      return false;
    }

    if (this.isExpired(entry)) {
      await this.deleteExpired(key);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    await this.runPlugins((plugin) => plugin.beforeClear?.());
    await this.store.clear();
    this.policy.onClear();
    await this.runPlugins((plugin) => plugin.afterClear?.());
  }

  async size(): Promise<number> {
    return this.store.size();
  }

  async keys(): Promise<readonly K[]> {
    return this.store.keys();
  }

  async values(): Promise<readonly V[]> {
    const entries = await this.store.entries();
    return entries.map(([, entry]) => entry.value);
  }

  async entries(): Promise<readonly (readonly [K, V])[]> {
    const entries = await this.store.entries();
    return entries.map(([key, entry]) => [key, entry.value] as const);
  }

  async statistics(): Promise<Readonly<CacheStatistics>> {
    return { ...this.stats };
  }

  async resetStatistics(): Promise<void> {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.writes = 0;
    this.stats.deletes = 0;
    this.stats.evictions = 0;
    this.stats.expirations = 0;
  }
}
