import { MemoryCache, MemoryCacheOptions } from './caches/memory.cache';
import { SystemClock } from './clocks/system.clock';
import { Cache } from './core/cache.interface';
import { CacheEntry } from './core/cache-entry';
import { MemoryCacheStorage } from './storage/memory-cache.storage';
import { RedisCacheStore, RedisClient } from './caches/redis.cache';
import { CacheSerializer } from './interfaces/cache-serializer.interface';
import { JsonCacheSerializer } from './utils/serializer';
import { MultiLevelCache } from './caches/multi-level.cache';
import {
  ReplacementPolicyFactory,
  ReplacementPolicyType,
} from './policies/replacement-policy.factory';
import { Clock } from './interfaces/clock.interface';
import {
  CachePlugin,
  CachePluginErrorHandler,
} from './interfaces/cache-plugin.interface';

export class CacheFactory {
  static memory<V>(
    options: MemoryCacheOptions,
    replacementPolicy: ReplacementPolicyType = 'lru',
    clock: Clock = new SystemClock(),
    plugins: readonly CachePlugin<string, V>[] = [],
    pluginErrorHandler?: CachePluginErrorHandler,
  ): Cache<string, V> {
    return new MemoryCache(
      new MemoryCacheStorage<string, CacheEntry<V>>(),
      ReplacementPolicyFactory.create<string>(replacementPolicy),
      options,
      clock,
      plugins,
      pluginErrorHandler,
    );
  }

  static redis<V>(
    client: RedisClient,
    serializer: CacheSerializer = new JsonCacheSerializer(),
    namespace = 'cache',
    ttl?: number,
    plugins: readonly CachePlugin<string, V>[] = [],
    pluginErrorHandler?: CachePluginErrorHandler,
  ): Cache<string, V> {
    return new RedisCacheStore(
      client,
      serializer,
      namespace,
      ttl,
      plugins,
      pluginErrorHandler,
    );
  }

  static multiLevel<V>(
    l1: Cache<string, V>,
    l2: Cache<string, V>,
  ): Cache<string, V> {
    return new MultiLevelCache(l1, l2);
  }
}
