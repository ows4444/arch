import { Cache } from './cache.interface';
import { CacheStatistics } from './cache-statistics';

export interface StatisticsAwareCache<K, V> extends Cache<K, V> {
  statistics(): Promise<Readonly<CacheStatistics>>;

  resetStatistics(): Promise<void>;
}
