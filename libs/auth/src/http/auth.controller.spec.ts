import { AuthController } from './auth.controller';
import type { AuthenticatedUser } from '../guards/jwt-auth.guard';

describe('AuthController', () => {
  function setup() {
    const auth = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthController(auth as never);

    return { controller, auth };
  }

  it('registers a user and returns only id/email', async () => {
    const { controller, auth } = setup();
    auth.register.mockResolvedValue({
      id: 'user-1',
      email: 'a@example.com',
      passwordHash: 'should-not-leak',
    });

    const result = await controller.register({
      email: 'a@example.com',
      password: 'super-secret-password',
    });

    expect(result).toEqual({ id: 'user-1', email: 'a@example.com' });
  });

  it('delegates login to AuthService, forwarding the caller IP/user-agent as refresh-token metadata', () => {
    const { controller, auth } = setup();
    const session = { accessToken: 'a', refreshToken: 'r' };
    auth.login.mockReturnValue(session);

    const dto = { email: 'a@example.com', password: 'pw' };
    expect(controller.login(dto, '203.0.113.5', 'test-agent')).toBe(session);
    expect(auth.login).toHaveBeenCalledWith(dto, {
      createdByIp: '203.0.113.5',
      userAgent: 'test-agent',
    });
  });

  it('delegates refresh to AuthService, forwarding the caller IP/user-agent as refresh-token metadata', () => {
    const { controller, auth } = setup();
    const session = { accessToken: 'a2', refreshToken: 'r2' };
    auth.refresh.mockReturnValue(session);

    expect(
      controller.refresh(
        { refreshToken: 'old-token' },
        '203.0.113.5',
        'test-agent',
      ),
    ).toBe(session);
    expect(auth.refresh).toHaveBeenCalledWith('old-token', {
      createdByIp: '203.0.113.5',
      userAgent: 'test-agent',
    });
  });

  it('logs out using the current access token jti/expiry and the supplied refresh token', async () => {
    const { controller, auth } = setup();
    const user: AuthenticatedUser = {
      userId: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
      jti: 'jti-1',
      tokenExpiresAt: new Date(),
    };

    await controller.logout(user, { refreshToken: 'rt-1' });

    expect(auth.logout).toHaveBeenCalledWith(
      'jti-1',
      user.tokenExpiresAt,
      'rt-1',
    );
  });

  it('logs out of every session for the current user', async () => {
    const { controller, auth } = setup();
    const user: AuthenticatedUser = {
      userId: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
      jti: 'jti-1',
      tokenExpiresAt: new Date(),
    };

    await controller.logoutAll(user);

    expect(auth.logoutAll).toHaveBeenCalledWith('user-1');
  });

  it('returns the authenticated user for /auth/me', () => {
    const { controller } = setup();
    const user: AuthenticatedUser = {
      userId: 'user-1',
      email: 'a@example.com',
      roles: ['admin'],
      permissions: [],
      jti: 'jti-1',
      tokenExpiresAt: new Date(),
    };

    expect(controller.me(user)).toBe(user);
  });
});
