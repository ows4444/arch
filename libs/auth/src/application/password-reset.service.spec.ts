import { PasswordResetService } from './password-reset.service';
import { PasswordResetTokenInvalidError } from '../errors/password-reset-token-invalid.error';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import type { AuthModuleOptions } from '../auth.types';

describe('PasswordResetService', () => {
  function setup(ttlSeconds = 3600) {
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
    const refreshTokens = {
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
    const passwordHasher = {
      algo: 'argon2id',
      hash: jest.fn().mockResolvedValue('new-hash'),
      verify: jest.fn(),
    };
    const options: AuthModuleOptions = {
      jwt: { secret: 'secret' },
      passwordResetTokenTtlSeconds: ttlSeconds,
    };
    const events = {
      publishPasswordChanged: jest.fn().mockResolvedValue(undefined),
      publishPasswordResetRequested: jest.fn().mockResolvedValue(undefined),
    };

    const service = new PasswordResetService(
      tokens as never,
      users as never,
      refreshTokens as never,
      passwordHasher,
      options,
      events as never,
    );

    return { service, tokens, users, refreshTokens, passwordHasher, events };
  }

  describe('requestReset', () => {
    it('invalidates prior tokens, issues a new one, and publishes it', async () => {
      const { service, tokens, users, events } = setup();
      users.findByEmail.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
      });

      await service.requestReset('A@Example.com');

      expect(users.findByEmail).toHaveBeenCalledWith('a@example.com');
      expect(tokens.invalidateActiveForUser).toHaveBeenCalledWith(
        'user-1',
        AuthTokenPurpose.PASSWORD_RESET,
      );
      expect(tokens.save).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          purpose: AuthTokenPurpose.PASSWORD_RESET,
        }),
      );
      expect(events.publishPasswordResetRequested).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', email: 'a@example.com' }),
      );
    });

    it('silently no-ops for an unknown email', async () => {
      const { service, users, tokens, events } = setup();
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.requestReset('nobody@example.com'),
      ).resolves.toBeUndefined();

      expect(tokens.save).not.toHaveBeenCalled();
      expect(events.publishPasswordResetRequested).not.toHaveBeenCalled();
    });
  });

  describe('confirmReset', () => {
    it('hashes the new password, consumes the token, and revokes every session', async () => {
      const { service, tokens, users, refreshTokens, passwordHasher, events } =
        setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      });
      users.findById.mockResolvedValue({ id: 'user-1' });

      await service.confirmReset('raw-token', 'brand-new-password');

      expect(passwordHasher.hash).toHaveBeenCalledWith('brand-new-password');
      expect(users.save).toHaveBeenCalledWith({
        id: 'user-1',
        passwordHash: 'new-hash',
        passwordAlgo: 'argon2id',
      });
      expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith('user-1');
      expect(events.publishPasswordChanged).toHaveBeenCalledWith({
        userId: 'user-1',
      });
    });

    it('rejects an unknown token', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue(null);

      await expect(
        service.confirmReset('bogus', 'new-password'),
      ).rejects.toThrow(PasswordResetTokenInvalidError);
    });

    it('rejects an expired token without consuming it', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue({
        id: 'token-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() - 1_000),
      });

      await expect(
        service.confirmReset('raw-token', 'new-password'),
      ).rejects.toThrow(PasswordResetTokenInvalidError);
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

      await expect(
        service.confirmReset('raw-token', 'new-password'),
      ).rejects.toThrow(PasswordResetTokenInvalidError);
    });
  });
});
