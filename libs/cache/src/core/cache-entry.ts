export interface CacheEntry<V> {
  value: V;

  createdAt: number;

  updatedAt: number;

  accessedAt: number;

  accessCount: number;

  expiresAt?: number | undefined;

  size?: number | undefined;

  metadata?: Record<string, unknown> | undefined;
}
