import { StaticRateLimiterRuleResolver } from './static-rate-limiter-rule.resolver';
import type { RateLimitModuleOptions } from '../ratelimit.types';

describe('StaticRateLimiterRuleResolver', () => {
  function setup(limiters: RateLimitModuleOptions['limiters']) {
    const options: RateLimitModuleOptions = {
      limiters,
      store: { type: 'memory' },
    };

    return new StaticRateLimiterRuleResolver(options);
  }

  it('resolves a plain limiter name from the static map', async () => {
    const resolver = setup({ login: { limit: 5, windowMs: 60_000 } });

    await expect(resolver.resolve('login')).resolves.toEqual({
      limit: 5,
      windowMs: 60_000,
    });
  });

  it('resolves undefined for an unconfigured name', async () => {
    const resolver = setup({});

    await expect(resolver.resolve('unknown')).resolves.toBeUndefined();
  });

  it('prefers a role-scoped entry over the plain name when a role is given', async () => {
    const resolver = setup({
      login: { limit: 5, windowMs: 60_000 },
      'login:role:admin': { limit: 50, windowMs: 60_000 },
    });

    await expect(resolver.resolve('login', { role: 'admin' })).resolves.toEqual(
      { limit: 50, windowMs: 60_000 },
    );
  });

  it('falls back to the plain name when no role-scoped entry exists', async () => {
    const resolver = setup({ login: { limit: 5, windowMs: 60_000 } });

    await expect(resolver.resolve('login', { role: 'admin' })).resolves.toEqual(
      { limit: 5, windowMs: 60_000 },
    );
  });
});
