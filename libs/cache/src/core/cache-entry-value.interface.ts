export interface CacheValue<V> {
  value: V;
  ttl: number | undefined;
}
