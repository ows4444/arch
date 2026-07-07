export interface CacheValue<V> {
  value: V;
  ttl?: number; // Remaining TTL in milliseconds
}
