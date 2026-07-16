import type { CacheModuleOptions } from './cache.interfaces';

export interface CacheOptionsFactory {
  createCacheOptions(): CacheModuleOptions | Promise<CacheModuleOptions>;
}
