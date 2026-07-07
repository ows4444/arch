export interface CacheEntry<V> {
  value: V;

  createdAt: number;

  updatedAt: number;

  accessedAt: number;

  accessCount: number;

  expiresAt?: number;

  size?: number;

  metadata?: Record<string, unknown>;
}
