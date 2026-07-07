import {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
} from '@nestjs/common';
import { RedisClient } from '../caches/redis.cache';
import { ReplacementPolicyType } from '../policies/replacement-policy.factory';
import { CacheSerializer } from './cache-serializer.interface';
import { Clock } from './clock.interface';
import { CachePlugin, CachePluginErrorHandler } from './cache-plugin.interface';

export interface MemoryCacheConfiguration {
  capacity: number;

  ttl?: number;

  slidingExpiration?: boolean;

  replacementPolicy?: ReplacementPolicyType;
}

export interface RedisCacheConfiguration {
  client: RedisClient;

  namespace?: string;

  ttl?: number;
}

export interface MultiLevelCacheConfiguration {
  l1: string;

  l2: string;
}

export type CacheConfiguration =
  | {
      type: 'memory';
      options: MemoryCacheConfiguration;
    }
  | {
      type: 'redis';
      options: RedisCacheConfiguration;
    }
  | {
      type: 'multi-level';
      options: MultiLevelCacheConfiguration;
    };

export interface CacheModuleOptions {
  defaultCache?: string;

  caches: Record<string, CacheConfiguration>;

  clock?: Clock;

  serializer?: CacheSerializer;

  plugins?: readonly CachePlugin<string, unknown>[];

  pluginErrorHandler?: CachePluginErrorHandler;
}

export interface CacheModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useFactory: (
    ...args: readonly unknown[]
  ) => CacheModuleOptions | Promise<CacheModuleOptions>;
}
