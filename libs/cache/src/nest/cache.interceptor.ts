import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, firstValueFrom, from } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER } from '../cache.constants';
import { type CacheManager } from '../cache-manager';
import { CACHEABLE_METADATA, CacheableOptions } from './cacheable.decorator';
import {
  CACHE_EVICT_METADATA,
  CacheEvictOptions,
} from './cache-evict.decorator';
import { CACHE_PUT_METADATA, CachePutOptions } from './cache-put.decorator';

@Injectable()
export class CacheInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CACHE_MANAGER)
    private readonly cacheManager: CacheManager,
  ) {}

  private getArguments(
    context: ExecutionContext,
  ): Parameters<CacheableOptions['key']> {
    return context.getArgs<Parameters<CacheableOptions['key']>>();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const args = this.getArguments(context);
    const evict = this.reflector.get<CacheEvictOptions>(
      CACHE_EVICT_METADATA,
      context.getHandler(),
    );

    const put = this.reflector.get<CachePutOptions>(
      CACHE_PUT_METADATA,
      context.getHandler(),
    );

    const metadata = this.reflector.get<CacheableOptions>(
      CACHEABLE_METADATA,
      context.getHandler(),
    );

    if (!metadata && !evict && !put) {
      return next.handle();
    }

    const execute = () =>
      next.handle().pipe(
        mergeMap(async (result: unknown) => {
          if (put) {
            await this.cacheManager.set(
              put.cache ?? 'default',
              put.key(...args),
              result,
              put.ttl,
            );
          }

          if (evict) {
            await this.cacheManager.delete(
              evict.cache ?? 'default',
              evict.key(...args),
            );
          }

          return result;
        }),
      );

    if (!metadata) {
      return execute();
    }

    const cache = metadata.cache ?? 'default';
    const key = metadata.key(...args);

    return from(this.cacheManager.get(cache, key)).pipe(
      mergeMap((cached) => {
        if (cached !== undefined) {
          return from(Promise.resolve(cached));
        }

        return from(
          this.cacheManager.getOrLoad(
            cache,
            key,
            () => firstValueFrom(execute()),
            {
              ...(metadata.ttl !== undefined && { ttl: metadata.ttl }),

              cache: (value) =>
                value !== undefined &&
                (value !== null || metadata.cacheNull === true),
            },
          ),
        );
      }),
    );
  }
}
