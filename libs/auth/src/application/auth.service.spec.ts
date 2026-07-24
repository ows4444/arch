import { AuthService } from './auth.service';
import { InvalidCredentialsError } from '../errors/invalid-credentials.error';
import { AccountDisabledError } from '../errors/account-disabled.error';
import { EmailNotVerifiedError } from '../errors/email-not-verified.error';
import { EmailAlreadyRegisteredError } from '../errors/email-already-registered.error';
import { UserStatus } from '../domain/user-status.enum';

describe('AuthService', () => {
  function setup() {
    const users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      save: jest.fn(),
    };
    const tokens = {
      sign: jest.fn().mockReturnValue({
        token: 'access-token',
        jti: 'jti-1',
        expiresAt: new Date(Date.now() + 900_000),
      }),
    };
    const refreshTokens = {
      issue: jest.fn().mockResolvedValue({
        token: 'refresh-token',
        expiresAt: new Date(Date.now() + 2_592_000_000),
      }),
      rotate: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    const emailVerification = {
      issue: jest.fn().mockResolvedValue(undefined),
    };
    const passwordHasher = {
      algo: 'argon2id',
      hash: jest.fn().mockResolvedValue('hashed'),
      verify: jest.fn(),
    };
    const events = {
      publishUserRegistered: jest.fn().mockResolvedValue(undefined),
      publishUserLoggedIn: jest.fn().mockResolvedValue(undefined),
      publishPasswordChanged: jest.fn().mockResolvedValue(undefined),
      publishRefreshTokenReuseDetected: jest.fn(),
      publishPasswordResetRequested: jest.fn().mockResolvedValue(undefined),
      publishEmailVerificationRequested: jest.fn().mockResolvedValue(undefined),
    };
    const denylist = {
      deny: jest.fn().mockResolvedValue(undefined),
      isDenied: jest.fn(),
    };

    const service = new AuthService(
      users as never,
      tokens as never,
      refreshTokens as never,
      emailVerification as never,
      passwordHasher,
      events,
      denylist,
    );

    return {
      service,
      users,
      tokens,
      refreshTokens,
      emailVerification,
      passwordHasher,
      events,
      denylist,
    };
  }

  describe('register', () => {
    it('hashes the password, persists a new unverified user, and issues a verification email', async () => {
      const { service, users, passwordHasher, events, emailVerification } =
        setup();
      users.findByEmail.mockResolvedValue(null);
      users.save.mockResolvedValue({ id: 'user-1', email: 'a@example.com' });

      const user = await service.register({
        email: 'A@Example.com',
        password: 'super-secret-password',
      });

      expect(passwordHasher.hash).toHaveBeenCalledWith('super-secret-password');
      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'a@example.com',
          passwordHash: 'hashed',
          passwordAlgo: 'argon2id',
          status: UserStatus.UNVERIFIED,
        }),
      );
      expect(user.id).toBe('user-1');
      expect(emailVerification.issue).toHaveBeenCalledWith(
        'user-1',
        'a@example.com',
      );
      expect(events.publishUserRegistered).toHaveBeenCalledWith({
        userId: 'user-1',
        email: 'a@example.com',
      });
    });

    it('rejects registering an email that already exists', async () => {
      const { service, users } = setup();
      users.findByEmail.mockResolvedValue({ id: 'existing' });

      await expect(
        service.register({ email: 'a@example.com', password: 'x'.repeat(20) }),
      ).rejects.toThrow(EmailAlreadyRegisteredError);
    });
  });

  describe('login', () => {
    it('issues an access+refresh token pair on valid credentials', async () => {
      const { service, users, passwordHasher, refreshTokens, events } = setup();
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        passwordHash: 'hashed',
        status: UserStatus.ACTIVE,
        roles: [],
      };
      users.findByEmail.mockResolvedValue(user);
      passwordHasher.verify.mockResolvedValue(true);

      const session = await service.login({
        email: 'a@example.com',
        password: 'correct-password',
      });

      expect(session.accessToken).toBe('access-token');
      expect(session.refreshToken).toBe('refresh-token');
      expect(refreshTokens.issue).toHaveBeenCalledWith('user-1', undefined);
      expect(events.publishUserLoggedIn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('rejects an unknown email without revealing whether the account exists', async () => {
      const { service, users } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'x' }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('rejects an incorrect password', async () => {
      const { service, users, passwordHasher } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hashed',
        status: UserStatus.ACTIVE,
        roles: [],
      });
      passwordHasher.verify.mockResolvedValue(false);

      await expect(
        service.login({ email: 'a@example.com', password: 'wrong' }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('rejects a disabled account even with correct credentials', async () => {
      const { service, users, passwordHasher } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hashed',
        status: UserStatus.DISABLED,
        roles: [],
      });
      passwordHasher.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'a@example.com', password: 'correct' }),
      ).rejects.toThrow(AccountDisabledError);
    });

    it('rejects an unverified account even with correct credentials', async () => {
      const { service, users, passwordHasher } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'hashed',
        status: UserStatus.UNVERIFIED,
        roles: [],
      });
      passwordHasher.verify.mockResolvedValue(true);

      await expect(
        service.login({ email: 'a@example.com', password: 'correct' }),
      ).rejects.toThrow(EmailNotVerifiedError);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token and denies the access token jti', async () => {
      const { service, refreshTokens, denylist } = setup();
      const expiresAt = new Date();

      await service.logout('jti-1', expiresAt, 'raw-refresh-token');

      expect(refreshTokens.revoke).toHaveBeenCalledWith('raw-refresh-token');
      expect(denylist.deny).toHaveBeenCalledWith('jti-1', expiresAt);
    });
  });

  describe('logoutAll', () => {
    it('revokes every refresh token for the user', async () => {
      const { service, refreshTokens } = setup();

      await service.logoutAll('user-1');

      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
    });
  });

  describe('changePassword', () => {
    it('rehashes the password, revokes every session, and publishes the change', async () => {
      const { service, users, passwordHasher, refreshTokens, events } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'old-hash',
      });
      passwordHasher.verify.mockResolvedValue(true);

      await service.changePassword(
        'user-1',
        'current-password',
        'new-password',
      );

      expect(passwordHasher.verify).toHaveBeenCalledWith(
        'old-hash',
        'current-password',
      );
      expect(passwordHasher.hash).toHaveBeenCalledWith('new-password');
      expect(users.save).toHaveBeenCalledWith({
        id: 'user-1',
        passwordHash: 'hashed',
        passwordAlgo: 'argon2id',
      });
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(events.publishPasswordChanged).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });

    it('rejects an incorrect current password without touching anything', async () => {
      const { service, users, passwordHasher, refreshTokens } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        passwordHash: 'old-hash',
      });
      passwordHasher.verify.mockResolvedValue(false);

      await expect(
        service.changePassword('user-1', 'wrong-password', 'new-password'),
      ).rejects.toThrow(InvalidCredentialsError);

      expect(users.save).not.toHaveBeenCalled();
      expect(refreshTokens.revokeAllForUser).not.toHaveBeenCalled();
    });
  });
});
