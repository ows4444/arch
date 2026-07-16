import { APP_INTERCEPTOR } from '@nestjs/core';
import { Provider } from '@nestjs/common';
import { CacheModule } from './cache.module';
import { CacheModuleOptions } from '../interfaces/cache.interfaces';

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
  });
});
