import { DefaultCacheManager } from './cache-manager.impl';
import { CacheRegistry } from './cache-registry';
import { Cache } from './core/cache.interface';

function fakeCache(
  overrides: Partial<Cache<string, unknown>> = {},
): Cache<string, unknown> {
  return {
    get: jest.fn().mockResolvedValue(undefined),
    set: jest.fn().mockResolvedValue(undefined),
    has: jest.fn().mockResolvedValue(false),
    delete: jest.fn().mockResolvedValue(false),
    clear: jest.fn().mockResolvedValue(undefined),
    size: jest.fn().mockResolvedValue(0),
    keys: jest.fn().mockResolvedValue([]),
    values: jest.fn().mockResolvedValue([]),
    entries: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe('DefaultCacheManager', () => {
  describe('clear', () => {
    it('clears a single named cache', async () => {
      const registry = new CacheRegistry();
      const cache = fakeCache();
      registry.register('users', cache);
      const manager = new DefaultCacheManager(registry);

      await manager.clear('users');

      expect(cache.clear).toHaveBeenCalledTimes(1);
    });

    it('clears every registered cache when called with no argument', async () => {
      const registry = new CacheRegistry();
      const a = fakeCache();
      const b = fakeCache();
      registry.register('a', a);
      registry.register('b', b);
      const manager = new DefaultCacheManager(registry);

      await manager.clear();

      expect(a.clear).toHaveBeenCalledTimes(1);
      expect(b.clear).toHaveBeenCalledTimes(1);
    });

    it('attempts to clear all caches and throws naming the ones that failed', async () => {
      const registry = new CacheRegistry();
      const error = new Error('redis cache cannot clear all keys');
      const ok = fakeCache();
      const failing = fakeCache({ clear: jest.fn().mockRejectedValue(error) });
      registry.register('ok', ok);
      registry.register('failing', failing);
      const manager = new DefaultCacheManager(registry);

      await expect(manager.clear()).rejects.toMatchObject({
        errors: [error],
      });
      expect(ok.clear).toHaveBeenCalledTimes(1);
      expect(failing.clear).toHaveBeenCalledTimes(1);
    });

    it('propagates a single-cache clear failure', async () => {
      const registry = new CacheRegistry();
      const error = new Error('boom');
      registry.register(
        'users',
        fakeCache({ clear: jest.fn().mockRejectedValue(error) }),
      );
      const manager = new DefaultCacheManager(registry);

      await expect(manager.clear('users')).rejects.toThrow('boom');
    });
  });
});
