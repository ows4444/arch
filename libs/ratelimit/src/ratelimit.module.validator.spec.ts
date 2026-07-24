import { RateLimitModuleValidator } from './ratelimit.module.validator';
import { RateLimitConfigurationError } from './errors/ratelimit-configuration.error';
import type { RateLimitModuleOptions } from './ratelimit.types';

describe('RateLimitModuleValidator', () => {
  it('accepts a valid memory-store configuration', () => {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 5, windowMs: 60_000 } },
      store: { type: 'memory' },
    };

    expect(() => RateLimitModuleValidator.validate(options)).not.toThrow();
  });

  it('rejects zero configured limiters', () => {
    const options: RateLimitModuleOptions = {
      limiters: {},
      store: { type: 'memory' },
    };

    expect(() => RateLimitModuleValidator.validate(options)).toThrow(
      RateLimitConfigurationError,
    );
  });

  it('rejects a non-positive limit', () => {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 0, windowMs: 60_000 } },
      store: { type: 'memory' },
    };

    expect(() => RateLimitModuleValidator.validate(options)).toThrow(
      RateLimitConfigurationError,
    );
  });

  it('rejects a non-positive windowMs', () => {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 5, windowMs: 0 } },
      store: { type: 'memory' },
    };

    expect(() => RateLimitModuleValidator.validate(options)).toThrow(
      RateLimitConfigurationError,
    );
  });

  it('rejects a redis store whose client has no eval support', () => {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 5, windowMs: 60_000 } },
      store: {
        type: 'redis',
        client: {
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          exists: jest.fn(),
        },
      },
    };

    expect(() => RateLimitModuleValidator.validate(options)).toThrow(
      RateLimitConfigurationError,
    );
  });

  it('accepts a redis store whose client has eval support', () => {
    const options: RateLimitModuleOptions = {
      limiters: { login: { limit: 5, windowMs: 60_000 } },
      store: {
        type: 'redis',
        client: {
          get: jest.fn(),
          set: jest.fn(),
          del: jest.fn(),
          exists: jest.fn(),
          eval: jest.fn(),
        },
      },
    };

    expect(() => RateLimitModuleValidator.validate(options)).not.toThrow();
  });
});
