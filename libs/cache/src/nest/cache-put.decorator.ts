import { SetMetadata } from '@nestjs/common';

export const CACHE_PUT_METADATA = Symbol('CACHE_PUT_METADATA');

export interface CachePutOptions {
  cache?: string;

  key: (...args: unknown[]) => string;

  ttl?: number;
}

export const CachePut = (options: CachePutOptions): MethodDecorator =>
  SetMetadata(CACHE_PUT_METADATA, options);
