import { CacheStatistics } from './core/cache-statistics';

export interface CacheLoadOptions {
  ttl?: number;

  cache?: (value: unknown) => boolean;
}

export interface CacheManager {
  get<T>(cache: string, key: string): Promise<T | undefined>;

  getOrLoad<T>(
    cache: string,
    key: string,
    loader: () => Promise<T>,
    options?: CacheLoadOptions,
  ): Promise<T>;

  set<T>(cache: string, key: string, value: T, ttl?: number): Promise<void>;

  delete(cache: string, key: string): Promise<void>;

  clear(cache?: string): Promise<void>;

  statistics(cache: string): Promise<Readonly<CacheStatistics> | undefined>;

  resetStatistics(cache: string): Promise<boolean>;
}
