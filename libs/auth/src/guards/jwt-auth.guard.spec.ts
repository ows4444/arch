import type { ExecutionContext } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  function setup(isPublic: boolean, isDenied = false) {
    const tokens = { verify: jest.fn() };
    const denylist = {
      deny: jest.fn(),
      isDenied: jest.fn().mockResolvedValue(isDenied),
    };
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublic),
    };
    const guard = new JwtAuthGuard(
      tokens as never,
      denylist,
      reflector as never,
    );

    const request: { headers: Record<string, string>; user?: unknown } = {
      headers: {},
    };

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { guard, tokens, denylist, request, context };
  }

  it('bypasses verification for a route marked @Public()', async () => {
    const { guard, context, tokens } = setup(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokens.verify).not.toHaveBeenCalled();
  });

  it('rejects a request with no bearer token', async () => {
    const { guard, context } = setup(false);

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing bearer token.',
    );
  });

  it('rejects an invalid token', async () => {
    const { guard, context, tokens, request } = setup(false);
    request.headers.authorization = 'Bearer bad-token';
    tokens.verify.mockImplementation(() => {
      throw new Error('invalid');
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'Invalid or expired token.',
    );
  });

  it('rejects a denylisted (revoked) access token', async () => {
    const { guard, context, tokens, request } = setup(false, true);
    request.headers.authorization = 'Bearer good-token';
    tokens.verify.mockReturnValue({
      sub: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
      jti: 'jti-1',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      'This token has been revoked.',
    );
  });

  it('attaches the authenticated user to the request on success', async () => {
    const { guard, context, tokens, request } = setup(false, false);
    request.headers.authorization = 'Bearer good-token';
    tokens.verify.mockReturnValue({
      sub: 'user-1',
      email: 'a@example.com',
      roles: ['admin'],
      permissions: ['workflow:read'],
      jti: 'jti-1',
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        email: 'a@example.com',
        roles: ['admin'],
        permissions: ['workflow:read'],
        jti: 'jti-1',
      }),
    );
  });
});
