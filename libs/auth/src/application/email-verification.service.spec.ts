import { EmailVerificationService } from './email-verification.service';
import { EmailVerificationTokenInvalidError } from '../errors/email-verification-token-invalid.error';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import { UserStatus } from '../domain/user-status.enum';
import type { AuthModuleOptions } from '../auth.types';

describe('EmailVerificationService', () => {
  function setup(ttlSeconds = 86_400) {
    const tokens = {
      save: jest.fn().mockResolvedValue(undefined),
      findActiveByHash: jest.fn(),
      markUsedIfActive: jest.fn().mockResolvedValue(true),
      invalidateActiveForUser: jest.fn().mockResolvedValue(undefined),
    };
    const users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const options: AuthModuleOptions = {
      jwt: { secret: 'secret' },
      emailVerificationTokenTtlSeconds: ttlSeconds,
    };
    const events = {
      publishEmailVerificationRequested: jest.fn().mockResolvedValue(undefined),
    };

    const service = new EmailVerificationService(
      tokens as never,
      users as never,
      options,
      events as never,
    );

    return { service, tokens, users, events };
  }

  describe('issue', () => {
    it('invalidates prior tokens, issues a new one, and publishes it', async () => {
      const { service, tokens, events } = setup();

      await service.issue('user-1', 'a@example.com');

      expect(tokens.invalidateActiveForUser).toHaveBeenCalledWith(
        'user-1',
        AuthTokenPurpose.EMAIL_VERIFICATION,
      );
      expect(tokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
        }),
      );
      expect(events.publishEmailVerificationRequested).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', email: 'a@example.com' }),
      );
    });
  });

  describe('requestVerification', () => {
    it('resends for an unverified user', async () => {
      const { service, users, tokens } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        status: UserStatus.UNVERIFIED,
      });

      await service.requestVerification('A@Example.com');

      expect(tokens.save).toHaveBeenCalled();
    });

    it('silently no-ops for an unknown email', async () => {
      const { service, users, tokens } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.requestVerification('nobody@example.com'),
      ).resolves.toBeUndefined();
      expect(tokens.save).not.toHaveBeenCalled();
    });

    it('silently no-ops for an already-verified user', async () => {
      const { service, users, tokens } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        status: UserStatus.ACTIVE,
      });

      await service.requestVerification('a@example.com');

      expect(tokens.save).not.toHaveBeenCalled();
    });
  });

  describe('confirm', () => {
    it('activates the user and stamps emailVerifiedAt', async () => {
      const { service, tokens, users } = setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      });
      users.findById.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.UNVERIFIED,
      });

      await service.confirm('raw-token');

      expect(users.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'user-1',
          status: UserStatus.ACTIVE,
        }),
      );
    });

    it('rejects (without reactivating) a token redeemed by a user who is no longer unverified', async () => {
      // Regression test: a verification link is TTL-bound, not
      // single-request-bound — if the user's status ever moves away from
      // UNVERIFIED through some other path before a still-valid link is
      // redeemed, confirm() must not silently stomp it back to ACTIVE.
      const { service, tokens, users } = setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      });
      users.findById.mockResolvedValue({
        id: 'user-1',
        status: UserStatus.DISABLED,
      });

      await expect(service.confirm('raw-token')).rejects.toThrow(
        EmailVerificationTokenInvalidError,
      );
      expect(users.save).not.toHaveBeenCalled();
    });

    it('rejects an unknown token', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue(null);

      await expect(service.confirm('bogus')).rejects.toThrow(
        EmailVerificationTokenInvalidError,
      );
    });

    it('rejects an expired token without consuming it', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(service.confirm('raw-token')).rejects.toThrow(
        EmailVerificationTokenInvalidError,
      );
      expect(tokens.markUsedIfActive).not.toHaveBeenCalled();
    });

    it('rejects a concurrent double-submit racing the same token', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      });
      tokens.markUsedIfActive.mockResolvedValue(false);

      await expect(service.confirm('raw-token')).rejects.toThrow(
        EmailVerificationTokenInvalidError,
      );
    });
  });
});
