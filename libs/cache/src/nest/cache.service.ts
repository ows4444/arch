import { Inject, Injectable } from '@nestjs/common';
import { CACHE } from '../cache.constants';
import { type Cache } from '../core/cache.interface';

@Injectable()
export class CacheService<K, V> {
  constructor(
    @Inject(CACHE)
    private readonly cache: Cache<K, V>,
  ) {}

  get(key: K): Promise<V | undefined> {
    return this.cache.get(key);
  }

  set(key: K, value: V, ttl?: number): Promise<void> {
    return this.cache.set(key, value, ttl !== undefined ? { ttl } : {});
  }

  delete(key: K): Promise<boolean> {
    return this.cache.delete(key);
  }

  clear(): Promise<void> {
    return this.cache.clear();
  }

  has(key: K): Promise<boolean> {
    return this.cache.has(key);
  }
}
