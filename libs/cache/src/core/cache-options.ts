export interface CacheOptions {
  capacity?: number;

  ttl?: number;

  cleanupInterval?: number;

  statistics?: boolean;

  slidingExpiration?: boolean;
}
