import { SetMetadata } from '@nestjs/common';

export const CACHE_EVICT_METADATA = Symbol('CACHE_EVICT_METADATA');

export interface CacheEvictOptions {
  cache?: string;

  key: (...args: unknown[]) => string;
}

export const CacheEvict = (options: CacheEvictOptions): MethodDecorator =>
  SetMetadata(CACHE_EVICT_METADATA, options);
