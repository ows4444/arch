import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import type { AuthModuleOptions } from '../auth.types';

describe('TokenService', () => {
  function setup(accessTokenTtlSeconds?: number) {
    const jwtService = new JwtService({ secret: 'test-secret-value' });
    const options: AuthModuleOptions = {
      jwt:
        accessTokenTtlSeconds === undefined
          ? { secret: 'test-secret-value' }
          : { secret: 'test-secret-value', accessTokenTtlSeconds },
    };
    const service = new TokenService(jwtService, options);

    return { service };
  }

  it('signs a token embedding the given claims plus a fresh jti', () => {
    const { service } = setup();

    const signed = service.sign({
      sub: 'user-1',
      email: 'a@example.com',
      roles: ['admin'],
      permissions: ['workflow:read'],
    });

    expect(signed.token).toEqual(expect.any(String));
    expect(signed.jti).toEqual(expect.any(String));
    expect(signed.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('verifies a token it signed and returns the original claims', () => {
    const { service } = setup();

    const signed = service.sign({
      sub: 'user-1',
      email: 'a@example.com',
      roles: ['admin'],
      permissions: ['workflow:read'],
    });

    const payload = service.verify(signed.token);

    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@example.com');
    expect(payload.roles).toEqual(['admin']);
    expect(payload.permissions).toEqual(['workflow:read']);
    expect(payload.jti).toBe(signed.jti);
    expect(payload.exp).toEqual(expect.any(Number));
  });

  it('throws when verifying a token signed with a different secret', () => {
    const { service } = setup();
    const other = new TokenService(new JwtService({ secret: 'other-secret' }), {
      jwt: { secret: 'other-secret' },
    });

    const signed = other.sign({
      sub: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
    });

    expect(() => service.verify(signed.token)).toThrow();
  });

  it('rejects an already-expired token', () => {
    const { service } = setup(-1);

    const signed = service.sign({
      sub: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
    });

    expect(() => service.verify(signed.token)).toThrow();
  });
});
