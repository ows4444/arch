import { APP_INTERCEPTOR } from '@nestjs/core';
import { Injectable, Module, Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CacheModule } from './cache.module';
import { CacheModuleOptions } from '../interfaces/cache.interfaces';
import { CacheOptionsFactory } from '../interfaces/cache-options.factory.interface';
import { CacheRegistry } from '../cache-registry';
import { CACHE } from '../cache.constants';
import { Cache } from '../core/cache.interface';
import type { TestingModule } from '@nestjs/testing';

function getCache(moduleRef: TestingModule): Cache<string, string> {
  return moduleRef.get<Cache<string, string>>(CACHE);
}

function baseOptions(registerInterceptor?: boolean): CacheModuleOptions {
  return {
    caches: {
      default: { type: 'memory', options: { capacity: 10 } },
    },
    ...(registerInterceptor !== undefined && { registerInterceptor }),
  };
}

function hasAppInterceptor(providers: Provider[] | undefined): boolean {
  return (providers ?? []).some(
    (provider) =>
      typeof provider === 'object' &&
      'provide' in provider &&
      provider.provide === APP_INTERCEPTOR,
  );
}

describe('CacheModule', () => {
  describe('forRoot', () => {
    it('registers a global APP_INTERCEPTOR by default', () => {
      const module = CacheModule.forRoot(baseOptions());

      expect(hasAppInterceptor(module.providers)).toBe(true);
    });

    it('omits the global APP_INTERCEPTOR when registerInterceptor is false', () => {
      const module = CacheModule.forRoot(baseOptions(false));

      expect(hasAppInterceptor(module.providers)).toBe(false);
    });
  });

  describe('forRootAsync', () => {
    it('registers a global APP_INTERCEPTOR by default', () => {
      const module = CacheModule.forRootAsync({
        useFactory: () => baseOptions(),
      });

      expect(hasAppInterceptor(module.providers)).toBe(true);
    });

    it('omits the global APP_INTERCEPTOR when registerInterceptor is false', () => {
      const module = CacheModule.forRootAsync({
        useFactory: () => baseOptions(),
        registerInterceptor: false,
      });

      expect(hasAppInterceptor(module.providers)).toBe(false);
    });

    it('resolves cache options via useFactory end-to-end (backward compatibility)', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          CacheModule.forRootAsync({
            useFactory: () => baseOptions(),
          }),
        ],
      }).compile();

      expect(moduleRef.get(CacheRegistry)).toBeInstanceOf(CacheRegistry);
      await expect(getCache(moduleRef).set('k', 'v')).resolves.toBeUndefined();
      await expect(getCache(moduleRef).get('k')).resolves.toBe('v');
    });

    it('resolves cache options via useClass end-to-end', async () => {
      @Injectable()
      class TestCacheOptionsFactory implements CacheOptionsFactory {
        createCacheOptions(): CacheModuleOptions {
          return baseOptions();
        }
      }

      const moduleRef = await Test.createTestingModule({
        imports: [
          CacheModule.forRootAsync({
            useClass: TestCacheOptionsFactory,
          }),
        ],
      }).compile();

      expect(moduleRef.get(CacheRegistry)).toBeInstanceOf(CacheRegistry);
      await expect(getCache(moduleRef).set('k', 'v')).resolves.toBeUndefined();
      await expect(getCache(moduleRef).get('k')).resolves.toBe('v');
    });

    it('resolves cache options via useExisting end-to-end', async () => {
      @Injectable()
      class TestCacheOptionsFactory implements CacheOptionsFactory {
        createCacheOptions(): CacheModuleOptions {
          return baseOptions();
        }
      }

      @Module({
        providers: [TestCacheOptionsFactory],
        exports: [TestCacheOptionsFactory],
      })
      class FactoryProviderModule {}

      const moduleRef = await Test.createTestingModule({
        imports: [
          CacheModule.forRootAsync({
            imports: [FactoryProviderModule],
            useExisting: TestCacheOptionsFactory,
          }),
        ],
      }).compile();

      expect(moduleRef.get(CacheRegistry)).toBeInstanceOf(CacheRegistry);
      await expect(getCache(moduleRef).set('k', 'v')).resolves.toBeUndefined();
      await expect(getCache(moduleRef).get('k')).resolves.toBe('v');
    });

    it('throws when none of useFactory/useClass/useExisting is set', () => {
      expect(() => CacheModule.forRootAsync({})).toThrow(
        'Invalid CacheModuleAsyncOptions.',
      );
    });
  });
});
