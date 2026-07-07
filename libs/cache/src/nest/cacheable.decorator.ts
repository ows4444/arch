import { SetMetadata } from '@nestjs/common';

export const CACHEABLE_METADATA = Symbol('CACHEABLE_METADATA');

export interface CacheableOptions<
  TArgs extends readonly unknown[] = readonly unknown[],
> {
  cache?: string;

  key: (...args: TArgs) => string;

  ttl?: number;

  cacheNull?: boolean;
}

export const Cacheable = <
  TArgs extends readonly unknown[] = readonly unknown[],
>(
  options: CacheableOptions<TArgs>,
): MethodDecorator => SetMetadata(CACHEABLE_METADATA, options);
