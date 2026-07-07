import { Cache } from './cache.interface';
import { MetadataAwareCache } from './cache-metadata.interface';

export function isMetadataAwareCache<K, V>(
  cache: Cache<K, V>,
): cache is MetadataAwareCache<K, V> {
  return (
    'getWithMetadata' in cache && typeof cache.getWithMetadata === 'function'
  );
}
