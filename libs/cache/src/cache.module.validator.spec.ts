import { CacheModuleValidator } from './cache.module.validator';
import { CacheModuleOptions } from './interfaces/cache.interfaces';
import { RedisClient } from './caches/redis.cache';

function memoryCache(capacity = 10): CacheModuleOptions['caches'][string] {
  return { type: 'memory', options: { capacity } };
}

function redisCache(): CacheModuleOptions['caches'][string] {
  return {
    type: 'redis',
    options: { client: {} as RedisClient },
  };
}

function multiLevelCache(
  l1: string,
  l2: string,
): CacheModuleOptions['caches'][string] {
  return { type: 'multi-level', options: { l1, l2 } };
}

function options(
  caches: CacheModuleOptions['caches'],
  defaultCache?: string,
): CacheModuleOptions {
  return {
    caches,
    ...(defaultCache !== undefined && { defaultCache }),
  };
}

describe('CacheModuleValidator', () => {
  it('accepts a valid, minimal single-memory-cache config', () => {
    expect(() =>
      CacheModuleValidator.validate(options({ default: memoryCache() })),
    ).not.toThrow();
  });

  it('accepts a valid multi-level config (memory L1 + redis L2)', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          l1: memoryCache(),
          l2: redisCache(),
          default: multiLevelCache('l1', 'l2'),
        }),
      ),
    ).not.toThrow();
  });

  it('rejects an empty caches map', () => {
    expect(() => CacheModuleValidator.validate(options({}))).toThrow(
      'At least one cache must be configured.',
    );
  });

  it('rejects a defaultCache not present in caches', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({ default: memoryCache() }, 'missing'),
      ),
    ).toThrow("Default cache 'missing' is not configured.");
  });

  it('rejects a multi-level cache whose l1 references an unknown cache', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          l2: redisCache(),
          combined: multiLevelCache('missingL1', 'l2'),
        }),
      ),
    ).toThrow("Cache 'combined' references unknown cache 'missingL1'.");
  });

  it('rejects a multi-level cache whose l2 references an unknown cache', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          l1: memoryCache(),
          combined: multiLevelCache('l1', 'missingL2'),
        }),
      ),
    ).toThrow("Cache 'combined' references unknown cache 'missingL2'.");
  });

  it('rejects a multi-level cache whose l1 self-references', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          l2: redisCache(),
          combined: multiLevelCache('combined', 'l2'),
        }),
      ),
    ).toThrow("Cache 'combined' cannot reference itself.");
  });

  it('rejects a multi-level cache whose l2 self-references', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          l1: memoryCache(),
          combined: multiLevelCache('l1', 'combined'),
        }),
      ),
    ).toThrow("Cache 'combined' cannot reference itself.");
  });

  it('rejects a direct two-cycle (A.l2 = B, B.l2 = A)', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          a: multiLevelCache('mem', 'b'),
          b: multiLevelCache('mem', 'a'),
          mem: memoryCache(),
        }),
      ),
    ).toThrow(/Circular cache dependency detected involving/);
  });

  it('rejects a longer cycle (A -> B -> C -> A)', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          a: multiLevelCache('mem', 'b'),
          b: multiLevelCache('mem', 'c'),
          c: multiLevelCache('mem', 'a'),
          mem: memoryCache(),
        }),
      ),
    ).toThrow(/Circular cache dependency detected involving/);
  });

  it('accepts a valid deeply nested multi-level config (a multi-level cache used as another multi-level cache l1/l2)', () => {
    // inner: memory + redis -> multi-level "inner"
    // outer: "inner" (multi-level) + another memory -> multi-level "outer"
    expect(() =>
      CacheModuleValidator.validate(
        options({
          mem1: memoryCache(),
          mem2: memoryCache(),
          redis1: redisCache(),
          inner: multiLevelCache('mem1', 'redis1'),
          outer: multiLevelCache('inner', 'mem2'),
        }),
      ),
    ).not.toThrow();
  });

  it('accepts two independent, non-overlapping multi-level caches in the same config', () => {
    expect(() =>
      CacheModuleValidator.validate(
        options({
          mem1: memoryCache(),
          redis1: redisCache(),
          combo1: multiLevelCache('mem1', 'redis1'),
          mem2: memoryCache(),
          redis2: redisCache(),
          combo2: multiLevelCache('mem2', 'redis2'),
        }),
      ),
    ).not.toThrow();
  });
});
