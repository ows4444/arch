export interface CacheStatistics {
  hits: number;

  misses: number;

  writes: number;

  deletes: number;

  evictions: number;

  expirations: number;
}
