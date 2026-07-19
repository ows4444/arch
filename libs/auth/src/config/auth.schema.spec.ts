import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuthEnvironmentSchema } from './auth.schema';

function validate(env: Record<string, string | undefined>) {
  const config = plainToInstance(AuthEnvironmentSchema, env, {
    enableImplicitConversion: true,
    excludeExtraneousValues: true,
  });

  return {
    config,
    errors: validateSync(config, { skipMissingProperties: false }),
  };
}

describe('AuthEnvironmentSchema', () => {
  it('passes with a valid secret and coerces optional TTLs to numbers', () => {
    const { config, errors } = validate({
      AUTH_JWT_SECRET: 'x'.repeat(40),
      AUTH_ACCESS_TOKEN_TTL_SECONDS: '900',
      AUTH_REFRESH_TOKEN_TTL_SECONDS: '2592000',
      UNRELATED_VAR: 'ignored',
    });

    expect(errors).toHaveLength(0);
    expect(config.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.AUTH_REFRESH_TOKEN_TTL_SECONDS).toBe(2_592_000);
  });

  it('passes when the optional TTL vars are absent', () => {
    const { errors } = validate({ AUTH_JWT_SECRET: 'x'.repeat(40) });

    expect(errors).toHaveLength(0);
  });

  it('rejects a secret shorter than 32 characters', () => {
    const { errors } = validate({ AUTH_JWT_SECRET: 'too-short' });

    expect(errors).not.toHaveLength(0);
    expect(errors[0]?.property).toBe('AUTH_JWT_SECRET');
  });

  it('rejects a missing secret', () => {
    const { errors } = validate({});

    expect(errors.some((error) => error.property === 'AUTH_JWT_SECRET')).toBe(
      true,
    );
  });
});
