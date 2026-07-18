import { CacheValue } from '../core/cache-entry-value.interface';
import { CacheStatistics } from '../core/cache-statistics';
import { CacheDeleteOptions, CacheSetOptions } from '../core/cache.interface';
import { StatisticsAwareCache } from '../core/statistics-aware-cache.interface';
import {
  CachePlugin,
  CachePluginErrorHandler,
  runCachePlugins,
} from '../interfaces/cache-plugin.interface';
import { CacheSerializer } from '../interfaces/cache-serializer.interface';
import { SafeJsonCacheSerializer } from '../utils/serializer';

export interface RedisClient {
  get(key: string): Promise<string | null>;

  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  del(key: string): Promise<number>;

  exists(key: string): Promise<boolean | number>;

  pttl?(key: string): Promise<number>;

  /**
   * Optional. When provided (alongside `unlink`), enables `clear()`/`keys()`/
   * `values()`/`entries()`/`size()` via a namespace-scoped `SCAN` instead of
   * always rejecting — safe because it's restricted to this cache's own
   * `namespace:*` prefix, unlike a broad `FLUSHDB`/`KEYS *`.
   */
  scan?(
    cursor: string,
    matchPattern: string,
    count: number,
  ): Promise<readonly [cursor: string, keys: string[]]>;

  /** Optional; see `scan`. */
  unlink?(...keys: string[]): Promise<number>;
}

export class RedisCacheStore<V> implements StatisticsAwareCache<string, V> {
  constructor(
    private readonly client: RedisClient,
    private readonly serializer: CacheSerializer = new SafeJsonCacheSerializer(),
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
    errors: 0,
  };

  private runPlugins(
    callback: (plugin: CachePlugin<string, V>) => Promise<void> | void,
  ): Promise<void> {
    return runCachePlugins(this.plugins, this.pluginErrorHandler, callback);
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
      this.stats.errors++;

      await this.runPlugins((plugin) => plugin.afterGet?.(key, undefined));

      return undefined;
    }
    this.stats.hits++;
    await this.runPlugins((plugin) => plugin.afterGet?.(key, deserialized));
    return deserialized;
  }

  async set(key: string, value: V, options?: CacheSetOptions): Promise<void> {
    await this.runPlugins((plugin) => plugin.beforeSet?.(key, value));
    const ttlMs = options?.ttl ?? this.ttl;
    await this.client.set(
      this.key(key),
      this.serializer.serialize(value),
      ttlMs === undefined ? undefined : Math.ceil(ttlMs / 1000),
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

  private static readonly SCAN_BATCH_SIZE = 100;

  /**
   * Enumerates every key under this cache's own `namespace:*` prefix via
   * `SCAN`, never touching keys outside it. Returns raw (namespaced) keys.
   */
  private async scanNamespaceKeys(): Promise<string[]> {
    const pattern = `${this.key('')}*`;
    const found: string[] = [];
    let cursor = '0';

    do {
      const [nextCursor, batch] = await this.client.scan!(
        cursor,
        pattern,
        RedisCacheStore.SCAN_BATCH_SIZE,
      );

      found.push(...batch);
      cursor = nextCursor;
    } while (cursor !== '0');

    return found;
  }

  async clear(): Promise<void> {
    if (!this.client.scan || !this.client.unlink) {
      throw new Error(
        'Redis cache cannot clear all keys: the configured RedisClient does ' +
          'not implement scan/unlink. Provide a client implementing both ' +
          "(safe — clear() only ever scans this cache's own namespace), or " +
          'use a namespaced Redis client implementation.',
      );
    }

    const keys = await this.scanNamespaceKeys();

    if (keys.length > 0) {
      await this.client.unlink(...keys);
    }
  }

  async keys(): Promise<readonly string[]> {
    if (!this.client.scan) {
      throw new Error(
        'Redis cache does not support enumerating keys: the configured ' +
          'RedisClient does not implement scan.',
      );
    }

    const prefix = this.key('');
    const raw = await this.scanNamespaceKeys();

    return raw.map((k) => k.slice(prefix.length));
  }

  async values(): Promise<readonly V[]> {
    const keys = await this.keys();
    const values: (V | undefined)[] = await Promise.all(
      keys.map((k) => this.get(k)),
    );

    return values.filter((v): v is V => v !== undefined);
  }

  async entries(): Promise<readonly (readonly [string, V])[]> {
    const keys = await this.keys();
    const pairs: (readonly [string, V | undefined])[] = await Promise.all(
      keys.map(async (k) => [k, await this.get(k)] as const),
    );

    return pairs.filter(
      (pair): pair is readonly [string, V] => pair[1] !== undefined,
    );
  }

  async size(): Promise<number> {
    const keys = await this.keys();

    return keys.length;
  }

  statistics(): Promise<Readonly<CacheStatistics>> {
    return Promise.resolve({ ...this.stats });
  }

  resetStatistics(): Promise<void> {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.writes = 0;
    this.stats.deletes = 0;
    this.stats.evictions = 0;
    this.stats.expirations = 0;
    this.stats.errors = 0;

    return Promise.resolve();
  }
}
