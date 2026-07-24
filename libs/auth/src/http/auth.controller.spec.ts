import { AuthController } from './auth.controller';
import type { AuthenticatedUser } from '../guards/jwt-auth.guard';
import { RATE_LIMIT_METADATA } from '@/ratelimit';

describe('AuthController', () => {
  function setup() {
    const auth = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn().mockResolvedValue(undefined),
      logoutAll: jest.fn().mockResolvedValue(undefined),
      changePassword: jest.fn().mockResolvedValue(undefined),
    };
    const passwordReset = {
      requestReset: jest.fn().mockResolvedValue(undefined),
      confirmReset: jest.fn().mockResolvedValue(undefined),
    };
    const emailVerification = {
      requestVerification: jest.fn().mockResolvedValue(undefined),
      confirm: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthController(
      auth as never,
      passwordReset as never,
      emailVerification as never,
    );

    return { controller, auth, passwordReset, emailVerification };
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

  it('forwards an optional deviceId from the login DTO as refresh-token metadata', () => {
    const { controller, auth } = setup();
    const session = { accessToken: 'a', refreshToken: 'r' };
    auth.login.mockReturnValue(session);

    const dto = {
      email: 'a@example.com',
      password: 'pw',
      deviceId: 'device-123',
    };
    expect(controller.login(dto, '203.0.113.5', 'test-agent')).toBe(session);

    expect(auth.login).toHaveBeenCalledWith(dto, {
      createdByIp: '203.0.113.5',
      userAgent: 'test-agent',
      deviceId: 'device-123',
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

  it('delegates changePassword to AuthService with the current user id', async () => {
    const { controller, auth } = setup();
    const user: AuthenticatedUser = {
      userId: 'user-1',
      email: 'a@example.com',
      roles: [],
      permissions: [],
      jti: 'jti-1',
      tokenExpiresAt: new Date(),
    };

    await controller.changePassword(user, {
      currentPassword: 'current-password',
      newPassword: 'new-password',
    });

    expect(auth.changePassword).toHaveBeenCalledWith(
      'user-1',
      'current-password',
      'new-password',
    );
  });

  it('delegates requestPasswordReset to PasswordResetService', async () => {
    const { controller, passwordReset } = setup();

    await controller.requestPasswordReset({ email: 'a@example.com' });

    expect(passwordReset.requestReset).toHaveBeenCalledWith('a@example.com');
  });

  it('delegates confirmPasswordReset to PasswordResetService', async () => {
    const { controller, passwordReset } = setup();

    await controller.confirmPasswordReset({
      token: 'raw-token',
      newPassword: 'new-password-value',
    });

    expect(passwordReset.confirmReset).toHaveBeenCalledWith(
      'raw-token',
      'new-password-value',
    );
  });

  it('delegates requestEmailVerification to EmailVerificationService', async () => {
    const { controller, emailVerification } = setup();

    await controller.requestEmailVerification({ email: 'a@example.com' });

    expect(emailVerification.requestVerification).toHaveBeenCalledWith(
      'a@example.com',
    );
  });

  it('delegates confirmEmailVerification to EmailVerificationService', async () => {
    const { controller, emailVerification } = setup();

    await controller.confirmEmailVerification({ token: 'raw-token' });

    expect(emailVerification.confirm).toHaveBeenCalledWith('raw-token');
  });

  it('tags login with the "login" rate limiter', () => {
    const metadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.login,
    );

    expect(metadata).toEqual({ limiterName: 'login' });
  });

  it('tags register with the "register" rate limiter', () => {
    const metadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.register,
    );

    expect(metadata).toEqual({ limiterName: 'register' });
  });

  it('tags password-reset request/confirm with the "password-reset" rate limiter', () => {
    const requestMetadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.requestPasswordReset,
    );
    const confirmMetadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.confirmPasswordReset,
    );

    expect(requestMetadata).toEqual({ limiterName: 'password-reset' });
    expect(confirmMetadata).toEqual({ limiterName: 'password-reset' });
  });

  it('tags email-verification request/confirm with the "email-verification" rate limiter', () => {
    const requestMetadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.requestEmailVerification,
    );
    const confirmMetadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.confirmEmailVerification,
    );

    expect(requestMetadata).toEqual({ limiterName: 'email-verification' });
    expect(confirmMetadata).toEqual({ limiterName: 'email-verification' });
  });

  it('tags changePassword with the "change-password" rate limiter', () => {
    const metadata: unknown = Reflect.getMetadata(
      RATE_LIMIT_METADATA,
      AuthController.prototype.changePassword,
    );

    expect(metadata).toEqual({ limiterName: 'change-password' });
  });
});
