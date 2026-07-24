import { DatabaseRateLimiterRuleResolver } from './database-rate-limiter-rule.resolver';
import type { RateLimitModuleOptions } from '../ratelimit.types';

describe('DatabaseRateLimiterRuleResolver', () => {
  function setup(cacheTtlMs = 10_000) {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 5, windowMs: 60_000 } },
      store: { type: 'memory' },
      rules: { enabled: true, cacheTtlMs },
    };
    const repository = { findByName: jest.fn() };
    const fallback = { resolve: jest.fn() };
    const resolver = new DatabaseRateLimiterRuleResolver(
      repository as never,
      options,
      fallback as never,
    );

    return { resolver, repository, fallback, options };
  }

  it('returns a DB-stored rule when one exists for the plain name', async () => {
    const { resolver, repository, fallback } = setup();
    repository.findByName.mockResolvedValue({
      name: 'login',
      limit: 20,
      windowMs: 30_000,
      algorithm: null,
      updatedAt: new Date(),
    });

    await expect(resolver.resolve('login')).resolves.toEqual({
      limit: 20,
      windowMs: 30_000,
    });
    expect(fallback.resolve).not.toHaveBeenCalled();
  });

  it('carries the algorithm field through when the DB row sets one', async () => {
    const { resolver, repository } = setup();
    repository.findByName.mockResolvedValue({
      name: 'login',
      limit: 20,
      windowMs: 30_000,
      algorithm: 'token-bucket',
      updatedAt: new Date(),
    });

    await expect(resolver.resolve('login')).resolves.toEqual({
      limit: 20,
      windowMs: 30_000,
      algorithm: 'token-bucket',
    });
  });

  it('falls back when no DB row exists for the name', async () => {
    const { resolver, repository, fallback } = setup();
    repository.findByName.mockResolvedValue(null);
    fallback.resolve.mockResolvedValue({ limit: 5, windowMs: 60_000 });

    const result = await resolver.resolve('login');

    expect(fallback.resolve).toHaveBeenCalledWith('login', undefined);
    expect(result).toEqual({ limit: 5, windowMs: 60_000 });
  });

  it('prefers a role-scoped DB row over the plain name', async () => {
    const { resolver, repository } = setup();
    repository.findByName.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'login:role:admin'
          ? {
              name,
              limit: 100,
              windowMs: 60_000,
              algorithm: null,
              updatedAt: new Date(),
            }
          : null,
      ),
    );

    const result = await resolver.resolve('login', { role: 'admin' });

    expect(repository.findByName).toHaveBeenCalledWith('login:role:admin');
    expect(result).toEqual({ limit: 100, windowMs: 60_000 });
  });

  it('caches a resolved rule and does not re-query within the TTL', async () => {
    const { resolver, repository } = setup(10_000);
    repository.findByName.mockResolvedValue({
      name: 'login',
      limit: 20,
      windowMs: 30_000,
      algorithm: null,
      updatedAt: new Date(),
    });

    await resolver.resolve('login');
    await resolver.resolve('login');

    expect(repository.findByName).toHaveBeenCalledTimes(1);
  });

  it('re-queries once the cache TTL has elapsed', async () => {
    const { resolver, repository } = setup(1);
    repository.findByName.mockResolvedValue({
      name: 'login',
      limit: 20,
      windowMs: 30_000,
      algorithm: null,
      updatedAt: new Date(),
    });

    await resolver.resolve('login');
    await new Promise((resolve) => setTimeout(resolve, 5));
    await resolver.resolve('login');

    expect(repository.findByName).toHaveBeenCalledTimes(2);
  });
});
