export interface CacheValue<V> {
  value: V;
  ttl: number | undefined; // Remaining TTL in milliseconds
}
