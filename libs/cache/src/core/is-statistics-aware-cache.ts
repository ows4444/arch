import { Cache } from './cache.interface';
import { StatisticsAwareCache } from './statistics-aware-cache.interface';

export function isStatisticsAwareCache<K, V>(
  cache: Cache<K, V>,
): cache is StatisticsAwareCache<K, V> {
  return (
    'statistics' in cache &&
    typeof cache.statistics === 'function' &&
    'resetStatistics' in cache &&
    typeof cache.resetStatistics === 'function'
  );
}
