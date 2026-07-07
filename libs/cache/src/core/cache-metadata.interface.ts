import { Cache } from './cache.interface';
import { CacheValue } from './cache-entry-value.interface';

export interface MetadataAwareCache<K, V> extends Cache<K, V> {
  getWithMetadata(key: K): Promise<CacheValue<V> | undefined>;
}
