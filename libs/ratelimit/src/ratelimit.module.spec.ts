import { APP_GUARD } from '@nestjs/core';
import { Provider } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RateLimitModule } from './ratelimit.module';
import { RateLimitModuleOptions } from './ratelimit.types';
import { RateLimitConfigurationError } from './errors/ratelimit-configuration.error';
import {
  RATE_LIMIT_METRICS,
  RATE_LIMIT_RULE_RESOLVER,
} from './ratelimit.constants';
import { NoopRateLimitMetrics } from './metrics/noop-rate-limit-metrics';
import { StaticRateLimiterRuleResolver } from './resolvers/static-rate-limiter-rule.resolver';
import { DatabaseRateLimiterRuleResolver } from './resolvers/database-rate-limiter-rule.resolver';
import type { RateLimitMetrics } from './core/rate-limit-metrics.interface';

function baseOptions(
  overrides: Partial<RateLimitModuleOptions> = {},
): RateLimitModuleOptions {
  return {
    limiters: { login: { limit: 5, windowMs: 60_000 } },
    store: { type: 'memory' },
    ...overrides,
  };
}

function hasAppGuard(providers: Provider[] | undefined): boolean {
  return (providers ?? []).some(
    (provider) =>
      typeof provider === 'object' &&
      'provide' in provider &&
      provider.provide === APP_GUARD,
  );
}

describe('RateLimitModule', () => {
  describe('forRoot', () => {
    it('registers a global APP_GUARD by default', () => {
      const module = RateLimitModule.forRoot(baseOptions());

      expect(hasAppGuard(module.providers)).toBe(true);
    });

    it('omits the global APP_GUARD when registerGuard is false', () => {
      const module = RateLimitModule.forRoot(
        baseOptions({ registerGuard: false }),
      );

      expect(hasAppGuard(module.providers)).toBe(false);
    });

    it('validates options at registration time, before any provider resolves', () => {
      expect(() =>
        RateLimitModule.forRoot(baseOptions({ limiters: {} })),
      ).toThrow(RateLimitConfigurationError);
    });
  });

  describe('forRootAsync', () => {
    it('registers a global APP_GUARD unconditionally', () => {
      const module = RateLimitModule.forRootAsync({
        useFactory: () => baseOptions(),
      });

      expect(hasAppGuard(module.providers)).toBe(true);
    });
  });

  describe('metrics wiring', () => {
    it('defaults RATE_LIMIT_METRICS to NoopRateLimitMetrics', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [RateLimitModule.forRoot(baseOptions())],
      }).compile();

      expect(moduleRef.get(RATE_LIMIT_METRICS)).toBeInstanceOf(
        NoopRateLimitMetrics,
      );
    });

    it('uses a supplied metrics implementation instead of the default', async () => {
      const customMetrics: RateLimitMetrics = {
        requestAllowed: jest.fn(),
        requestRejected: jest.fn(),
        storeFailure: jest.fn(),
      };

      const moduleRef = await Test.createTestingModule({
        imports: [
          RateLimitModule.forRoot(baseOptions({ metrics: customMetrics })),
        ],
      }).compile();

      expect(moduleRef.get(RATE_LIMIT_METRICS)).toBe(customMetrics);
    });
  });

  describe('dynamic rule resolver wiring', () => {
    it('wires RATE_LIMIT_RULE_RESOLVER to StaticRateLimiterRuleResolver by default', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [RateLimitModule.forRoot(baseOptions())],
      }).compile();

      expect(moduleRef.get(RATE_LIMIT_RULE_RESOLVER)).toBeInstanceOf(
        StaticRateLimiterRuleResolver,
      );
    });

    it('includes DatabaseRateLimiterRuleResolver as a provider when rules.enabled is true', () => {
      const module = RateLimitModule.forRoot(
        baseOptions({ rules: { enabled: true } }),
      );

      expect(module.providers).toContain(DatabaseRateLimiterRuleResolver);
    });

    it('does not include DatabaseRateLimiterRuleResolver when rules.enabled is not set', () => {
      const module = RateLimitModule.forRoot(baseOptions());

      expect(module.providers).not.toContain(DatabaseRateLimiterRuleResolver);
    });

    it('forRootAsync always wires the static resolver, never the DB-backed one', async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          RateLimitModule.forRootAsync({ useFactory: () => baseOptions() }),
        ],
      }).compile();

      expect(moduleRef.get(RATE_LIMIT_RULE_RESOLVER)).toBeInstanceOf(
        StaticRateLimiterRuleResolver,
      );
    });
  });
});
