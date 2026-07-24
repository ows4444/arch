import { RateLimiterService } from './rate-limiter.service';
import { RateLimitConfigurationError } from '../errors/ratelimit-configuration.error';
import type { RateLimitModuleOptions } from '../ratelimit.types';

describe('RateLimiterService', () => {
  function setup(optionOverrides: Partial<RateLimitModuleOptions> = {}) {
    const options: RateLimitModuleOptions = {
      limiters: {
        login: { limit: 5, windowMs: 60_000 },
      },
      store: { type: 'memory' },
      ...optionOverrides,
    };
    const store = {
      consume: jest.fn().mockResolvedValue({
        allowed: true,
        limit: 5,
        remaining: 4,
        resetAt: new Date(),
      }),
    };
    const metrics = {
      requestAllowed: jest.fn(),
      requestRejected: jest.fn(),
      storeFailure: jest.fn(),
    };
    const resolver = {
      resolve: jest.fn((limiterName: string) =>
        Promise.resolve(options.limiters[limiterName]),
      ),
    };
    const service = new RateLimiterService(options, store, metrics, resolver);

    return { service, store, options, metrics, resolver };
  }

  it('resolves the named limiter config through the resolver and scopes the store key by limiter name', async () => {
    const { service, store, resolver } = setup();

    await service.consume('login', '1.2.3.4');

    expect(resolver.resolve).toHaveBeenCalledWith('login', undefined);
    expect(store.consume).toHaveBeenCalledWith('login:1.2.3.4', {
      limit: 5,
      windowMs: 60_000,
    });
  });

  it('passes an optional role context through to the resolver', async () => {
    const { service, resolver } = setup();

    await service.consume('login', '1.2.3.4', { role: 'admin' });

    expect(resolver.resolve).toHaveBeenCalledWith('login', { role: 'admin' });
  });

  it('escapes a colon in the key so an IPv6 address cannot collide with a differently-scoped limiter/key pair', async () => {
    const { service, store } = setup({
      limiters: {
        'a:b': { limit: 5, windowMs: 60_000 },
        a: { limit: 5, windowMs: 60_000 },
      },
    });

    await service.consume('a:b', 'c');
    await service.consume('a', 'b:c');

    expect(store.consume).toHaveBeenNthCalledWith(1, 'a:b:c', {
      limit: 5,
      windowMs: 60_000,
    });
    expect(store.consume).toHaveBeenNthCalledWith(2, 'a:b%3Ac', {
      limit: 5,
      windowMs: 60_000,
    });
  });

  it('throws for an unconfigured limiter name', async () => {
    const { service } = setup();

    await expect(service.consume('unknown', '1.2.3.4')).rejects.toThrow(
      RateLimitConfigurationError,
    );
  });

  describe('fail-open behavior', () => {
    it('allows the request when the store throws and failOpen is not set (default)', async () => {
      const { service, store } = setup();
      store.consume.mockRejectedValue(new Error('Redis connection refused'));

      const result = await service.consume('login', '1.2.3.4');

      expect(result.allowed).toBe(true);
      expect(result.limit).toBe(5);
      expect(result.remaining).toBe(5);
      expect(result.resetAt).toBeInstanceOf(Date);
    });

    it('allows the request when the store throws and failOpen is explicitly true', async () => {
      const { service, store } = setup({ failOpen: true });
      store.consume.mockRejectedValue(new Error('Redis connection refused'));

      await expect(service.consume('login', '1.2.3.4')).resolves.toMatchObject({
        allowed: true,
      });
    });

    it('propagates the store error when failOpen is explicitly false', async () => {
      const { service, store } = setup({ failOpen: false });
      const storeError = new Error('Redis connection refused');
      store.consume.mockRejectedValue(storeError);

      await expect(service.consume('login', '1.2.3.4')).rejects.toBe(
        storeError,
      );
    });
  });

  describe('metrics', () => {
    it('records requestAllowed on an allowed result', async () => {
      const { service, metrics } = setup();

      await service.consume('login', '1.2.3.4');

      expect(metrics.requestAllowed).toHaveBeenCalledWith('login');
      expect(metrics.requestRejected).not.toHaveBeenCalled();
    });

    it('records requestRejected on a rejected result', async () => {
      const { service, store, metrics } = setup();
      store.consume.mockResolvedValue({
        allowed: false,
        limit: 5,
        remaining: 0,
        resetAt: new Date(),
      });

      await service.consume('login', '1.2.3.4');

      expect(metrics.requestRejected).toHaveBeenCalledWith('login');
      expect(metrics.requestAllowed).not.toHaveBeenCalled();
    });

    it('records storeFailure on the fail-open path', async () => {
      const { service, store, metrics } = setup();
      store.consume.mockRejectedValue(new Error('Redis connection refused'));

      await service.consume('login', '1.2.3.4');

      expect(metrics.storeFailure).toHaveBeenCalledWith('login');
    });
  });
});
