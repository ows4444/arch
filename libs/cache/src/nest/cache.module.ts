import { DynamicModule, Module, Provider } from '@nestjs/common';
import { CACHE, CACHE_MANAGER, CACHE_OPTIONS } from '../cache.constants';
import { CacheFactory } from '../cache.factory';
import { CacheRegistry } from '../cache-registry';
import { DefaultCacheManager } from '../cache-manager.impl';
import {
  CacheModuleAsyncOptions,
  CacheModuleOptions,
} from '../interfaces/cache.interfaces';
import { CacheService } from './cache.service';
import { CacheModuleValidator } from '../cache.module.validator';
import { CacheInterceptor } from './cache.interceptor';
import { APP_INTERCEPTOR } from '@nestjs/core';

@Module({})
export class CacheModule {
  private static createRegistry(options: CacheModuleOptions): CacheRegistry {
    const registry = new CacheRegistry();

    const build = (name: string): void => {
      if (registry.has(name)) {
        return;
      }

      const config = options.caches[name];

      switch (config?.type) {
        case 'memory':
          registry.register(
            name,
            CacheFactory.memory(
              config.options,
              config.options.replacementPolicy,
              options.clock,
              options.plugins,
              options.pluginErrorHandler,
            ),
          );
          return;

        case 'redis':
          registry.register(
            name,
            CacheFactory.redis(
              config.options.client,
              options.serializer,
              config.options.namespace,
              config.options.ttl,
              options.plugins,
              options.pluginErrorHandler,
            ),
          );
          return;

        case 'multi-level':
          build(config.options.l1);
          build(config.options.l2);

          registry.register(
            name,
            CacheFactory.multiLevel(
              registry.get(config.options.l1),
              registry.get(config.options.l2),
            ),
          );
      }
    };

    for (const name of Object.keys(options.caches)) {
      build(name);
    }

    return registry;
  }

  static forRoot(options: CacheModuleOptions): DynamicModule {
    CacheModuleValidator.validate(options);
    return {
      module: CacheModule,
      providers: [
        {
          provide: CacheRegistry,
          useFactory: () => this.createRegistry(options),
        },
        {
          provide: CACHE,
          useFactory: (registry: CacheRegistry) =>
            registry.get(options.defaultCache ?? 'default'),
          inject: [CacheRegistry],
        },
        {
          provide: CACHE_MANAGER,
          useFactory: (registry: CacheRegistry) =>
            new DefaultCacheManager(registry),
          inject: [CacheRegistry],
        },
        ...this.interceptorProviders(options.registerInterceptor),
        CacheService,
        CacheInterceptor,
      ],
      exports: [
        CACHE,
        CACHE_MANAGER,
        CacheRegistry,
        CacheService,
        CacheInterceptor,
      ],
    };
  }

  private static interceptorProviders(
    registerInterceptor: boolean | undefined,
  ): Provider[] {
    if (registerInterceptor === false) {
      return [];
    }

    return [{ provide: APP_INTERCEPTOR, useClass: CacheInterceptor }];
  }

  static forRootAsync(options: CacheModuleAsyncOptions): DynamicModule {
    return {
      module: CacheModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: CACHE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
        {
          provide: CacheRegistry,
          useFactory: (cacheOptions: CacheModuleOptions) => {
            CacheModuleValidator.validate(cacheOptions);
            return this.createRegistry(cacheOptions);
          },
          inject: [CACHE_OPTIONS],
        },
        {
          provide: CACHE,
          useFactory: (
            registry: CacheRegistry,
            cacheOptions: CacheModuleOptions,
          ) => registry.get(cacheOptions.defaultCache ?? 'default'),
          inject: [CacheRegistry, CACHE_OPTIONS],
        },
        {
          provide: CACHE_MANAGER,
          useFactory: (registry: CacheRegistry) =>
            new DefaultCacheManager(registry),
          inject: [CacheRegistry],
        },
        ...this.interceptorProviders(options.registerInterceptor),
        CacheService,
        CacheInterceptor,
      ],
      exports: [
        CACHE,
        CACHE_MANAGER,
        CacheRegistry,
        CacheService,
        CacheInterceptor,
      ],
    };
  }
}
