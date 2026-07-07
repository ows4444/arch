import { CacheValue } from '../core/cache-entry-value.interface';
import { CacheStatistics } from '../core/cache-statistics';
import {
  Cache,
  CacheDeleteOptions,
  CacheSetOptions,
} from '../core/cache.interface';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';
import {
  CachePlugin,
  CachePluginErrorHandler,
  defaultPluginErrorHandler,
} from '../interfaces/cache-plugin.interface';
import { CacheSerializer } from '../interfaces/cache-serializer.interface';
import { JsonCacheSerializer } from '../utils/serializer';

export interface RedisClient {
  get(key: string): Promise<string | null>;

  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  del(key: string): Promise<number>;

  exists(key: string): Promise<boolean | number>;

  pttl?(key: string): Promise<number>;
}

export class RedisCacheStore<V> implements StatisticsAwareCache<string, V> {
  constructor(
    private readonly client: RedisClient,
    private readonly serializer: CacheSerializer = new JsonCacheSerializer(),
    private readonly namespace = 'cache',
    private readonly ttl?: number,
    private readonly plugins: readonly CachePlugin<string, V>[] = [],
    private readonly pluginErrorHandler?: CachePluginErrorHandler,
  ) {}

  private key(key: string): string {
    return `${this.namespace}:${key}`;
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
    callback: (plugin: CachePlugin<string, V>) => Promise<void> | void,
  ): Promise<void> {
    for (const plugin of this.plugins) {
      try {
        await callback(plugin);
      } catch (error) {
        (this.pluginErrorHandler ?? defaultPluginErrorHandler)(error, plugin);
      }
    }
  }

  async getWithMetadata(key: string): Promise<CacheValue<V> | undefined> {
    const value = await this.get(key);

    if (value === undefined) {
      return undefined;
    }

    let ttl: number | undefined;

    if (this.client.pttl) {
      const remaining = await this.client.pttl(this.key(key));

      if (remaining >= 0) {
        ttl = remaining;
      }
    }

    return {
      value,
      ttl,
    };
  }

  async get(key: string): Promise<V | undefined> {
    await this.runPlugins((plugin) => plugin.beforeGet?.(key));

    const value = await this.client.get(this.key(key));

    if (value === null) {
      this.stats.misses++;
      await this.runPlugins((plugin) => plugin.afterGet?.(key, undefined));
      return undefined;
    }

    const deserialized = this.serializer.deserialize<V>(value);
    if (deserialized === undefined) {
      this.stats.misses++;

      await this.runPlugins((plugin) => plugin.afterGet?.(key, undefined));

      return undefined;
    }
    this.stats.hits++;
    await this.runPlugins((plugin) => plugin.afterGet?.(key, deserialized));
    return deserialized;
  }

  async set(key: string, value: V, options?: CacheSetOptions): Promise<void> {
    await this.runPlugins((plugin) => plugin.beforeSet?.(key, value));
    await this.client.set(
      this.key(key),
      this.serializer.serialize(value),
      options?.ttl ?? this.ttl,
    );
    this.stats.writes++;
    await this.runPlugins((plugin) => plugin.afterSet?.(key, value));
  }

  async delete(key: string, _options?: CacheDeleteOptions): Promise<boolean> {
    await this.runPlugins((plugin) => plugin.beforeDelete?.(key));
    const deleted = (await this.client.del(this.key(key))) > 0;
    if (deleted) {
      this.stats.deletes++;
      await this.runPlugins((plugin) => plugin.afterDelete?.(key));
    }
    return deleted;
  }

  async has(key: string): Promise<boolean> {
    return Boolean(await this.client.exists(this.key(key)));
  }

  async clear(): Promise<void> {
    throw new Error(
      'Redis cache cannot clear all keys. Use a namespaced Redis client implementation.',
    );
  }

  async size(): Promise<number> {
    throw new Error('Redis does not efficiently support cache size.');
  }

  async keys(): Promise<readonly string[]> {
    throw new Error('Redis cache does not support enumerating keys.');
  }

  async values(): Promise<readonly V[]> {
    throw new Error('Redis cache does not support enumerating values.');
  }

  async entries(): Promise<readonly (readonly [string, V])[]> {
    throw new Error('Redis cache does not support enumerating entries.');
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
