import 'reflect-metadata';
import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of } from 'rxjs';
import { CacheInterceptor } from './cache.interceptor';
import { CacheManager } from '../cache-manager';
import { Cacheable } from './cacheable.decorator';
import { CachePut } from './cache-put.decorator';
import { CacheEvict } from './cache-evict.decorator';

function fakeCacheManager(overrides: Partial<CacheManager> = {}): CacheManager {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    getOrLoad: jest.fn(async (_cache, _key, loader) => loader()),
    set: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
    statistics: jest.fn().mockResolvedValue(undefined),
    resetStatistics: jest.fn().mockResolvedValue(false),
    ...overrides,
  };
}

function fakeContext<Args extends unknown[]>(
  handler: (...args: Args) => unknown,
  args: Args,
): ExecutionContext {
  return {
    getArgs: () => args,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function fakeCallHandler(result: unknown): CallHandler {
  return { handle: () => of(result) };
}

class TestController {
  @Cacheable({ cache: 'items', key: (id: string) => `item:${id}` })
  getItem(_id: string): string {
    return 'handler-result';
  }

  @Cacheable({
    cache: 'items',
    key: (id: string) => `item:${id}`,
    cacheNull: true,
  })
  getNullableItem(_id: string): null {
    return null;
  }

  @CachePut({
    cache: 'items',
    key: (...args: unknown[]) => `item:${args[0] as string}`,
  })
  updateItem(_id: string): string {
    return 'updated';
  }

  @CacheEvict({
    cache: 'items',
    key: (...args: unknown[]) => `item:${args[0] as string}`,
  })
  deleteItem(_id: string): void {
    // no-op
  }

  plainMethod(): string {
    return 'plain-result';
  }
}

describe('CacheInterceptor', () => {
  const reflector = new Reflector();

  it('passes through untouched when no cache decorator is present', async () => {
    const cacheManager = fakeCacheManager();
    const interceptor = new CacheInterceptor(reflector, cacheManager);
    const controller = new TestController();

    const observable = interceptor.intercept(
      fakeContext(controller.plainMethod, []),
      fakeCallHandler('plain-result'),
    );

    await expect(firstValueFrom(observable)).resolves.toBe('plain-result');
    expect(cacheManager.get).not.toHaveBeenCalled();
  });

  describe('@Cacheable', () => {
    it('returns the cached value without invoking the handler on a hit', async () => {
      const cacheManager = fakeCacheManager({
        get: jest.fn().mockResolvedValue('cached-value'),
      });
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();
      const handle = jest.fn(() => of('handler-result'));

      const observable = interceptor.intercept(
        fakeContext(controller.getItem, ['42']),
        { handle },
      );

      await expect(firstValueFrom(observable)).resolves.toBe('cached-value');
      expect(cacheManager.get).toHaveBeenCalledWith('items', 'item:42');
      expect(handle).not.toHaveBeenCalled();
    });

    it('invokes the handler and populates the cache on a miss', async () => {
      const cacheManager = fakeCacheManager();
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();

      const observable = interceptor.intercept(
        fakeContext(controller.getItem, ['42']),
        fakeCallHandler('handler-result'),
      );

      await expect(firstValueFrom(observable)).resolves.toBe('handler-result');

      const call = (cacheManager.getOrLoad as jest.Mock).mock.calls[0] as [
        string,
        string,
        () => Promise<unknown>,
        { cache?: (value: unknown) => boolean },
      ];

      expect(call[0]).toBe('items');
      expect(call[1]).toBe('item:42');
      expect(typeof call[2]).toBe('function');
      expect(typeof call[3].cache).toBe('function');
    });

    it('does not cache a null result unless cacheNull is set', async () => {
      const cacheManager = fakeCacheManager();
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();

      await firstValueFrom(
        interceptor.intercept(
          fakeContext(controller.getItem, ['42']),
          fakeCallHandler(null),
        ),
      );

      const call = (cacheManager.getOrLoad as jest.Mock).mock.calls[0] as [
        string,
        string,
        () => Promise<unknown>,
        { cache?: (value: unknown) => boolean },
      ];
      const shouldCache = call[3].cache!;

      expect(shouldCache(null)).toBe(false);
      expect(shouldCache(undefined)).toBe(false);
      expect(shouldCache('value')).toBe(true);
    });

    it('caches a null result when cacheNull is set', async () => {
      const cacheManager = fakeCacheManager();
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();

      await firstValueFrom(
        interceptor.intercept(
          fakeContext(controller.getNullableItem, ['42']),
          fakeCallHandler(null),
        ),
      );

      const call = (cacheManager.getOrLoad as jest.Mock).mock.calls[0] as [
        string,
        string,
        () => Promise<unknown>,
        { cache?: (value: unknown) => boolean },
      ];

      expect(call[3].cache!(null)).toBe(true);
    });
  });

  describe('@CachePut', () => {
    it('always invokes the handler and writes its result to the cache', async () => {
      const cacheManager = fakeCacheManager();
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();

      const observable = interceptor.intercept(
        fakeContext(controller.updateItem, ['42']),
        fakeCallHandler('updated'),
      );

      await expect(firstValueFrom(observable)).resolves.toBe('updated');
      expect(cacheManager.set).toHaveBeenCalledWith(
        'items',
        'item:42',
        'updated',
        undefined,
      );
    });
  });

  describe('@CacheEvict', () => {
    it('always invokes the handler and evicts the key from the cache', async () => {
      const cacheManager = fakeCacheManager();
      const interceptor = new CacheInterceptor(reflector, cacheManager);
      const controller = new TestController();

      const observable = interceptor.intercept(
        fakeContext(controller.deleteItem, ['42']),
        fakeCallHandler(undefined),
      );

      await firstValueFrom(observable);
      expect(cacheManager.delete).toHaveBeenCalledWith('items', 'item:42');
    });
  });
});
