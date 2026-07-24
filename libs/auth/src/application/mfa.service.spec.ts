import { authenticator } from 'otplib';
import { MfaService } from './mfa.service';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import { MfaAlreadyEnabledError } from '../errors/mfa-already-enabled.error';
import { MfaEnrollmentNotPendingError } from '../errors/mfa-enrollment-not-pending.error';
import { MfaChallengeInvalidError } from '../errors/mfa-challenge-invalid.error';
import { MfaCodeInvalidError } from '../errors/mfa-code-invalid.error';
import { MfaNotEnabledError } from '../errors/mfa-not-enabled.error';
import type { AuthModuleOptions } from '../auth.types';

describe('MfaService', () => {
  function setup() {
    const secrets = {
      findByUserId: jest.fn(),
      upsertPending: jest.fn().mockResolvedValue(undefined),
      markEnabled: jest.fn().mockResolvedValue(undefined),
      deleteForUser: jest.fn().mockResolvedValue(undefined),
    };
    const tokens = {
      save: jest.fn().mockResolvedValue(undefined),
      findActiveByHash: jest.fn(),
      markUsedIfActive: jest.fn().mockResolvedValue(true),
      invalidateActiveForUser: jest.fn().mockResolvedValue(undefined),
    };
    // Reversible "encryption" for test purposes only — real coverage of the
    // actual cipher lives in aes-gcm-mfa-secret-cipher.spec.ts.
    const cipher = {
      encrypt: jest.fn((plaintext: string) => `enc:${plaintext}`),
      decrypt: jest.fn((ciphertext: string) => ciphertext.replace('enc:', '')),
    };
    const options: AuthModuleOptions = { jwt: { secret: 'secret' } };
    const audit = { record: jest.fn().mockResolvedValue(undefined) };

    const service = new MfaService(
      secrets as never,
      tokens as never,
      cipher,
      options,
      audit as never,
    );

    return { service, secrets, tokens, cipher, audit };
  }

  describe('beginEnrollment', () => {
    it('stores an encrypted pending secret and returns an otpauth URL', async () => {
      const { service, secrets, cipher } = setup();
      secrets.findByUserId.mockResolvedValue(null);

      const result = await service.beginEnrollment('user-1', 'a@example.com');

      expect(cipher.encrypt).toHaveBeenCalledWith(result.secret);
      expect(secrets.upsertPending).toHaveBeenCalledWith(
        'user-1',
        `enc:${result.secret}`,
      );
      expect(result.otpauthUrl).toContain('a%40example.com');
    });

    it('rejects re-enrollment while already enabled', async () => {
      const { service, secrets } = setup();
      secrets.findByUserId.mockResolvedValue({ enabled: true });

      await expect(
        service.beginEnrollment('user-1', 'a@example.com'),
      ).rejects.toThrow(MfaAlreadyEnabledError);
    });
  });

  describe('confirmEnrollment', () => {
    it('enables MFA and returns recovery codes on a correct code', async () => {
      const { service, secrets, tokens, audit } = setup();
      const secret = authenticator.generateSecret();
      secrets.findByUserId.mockResolvedValue({
        enabled: false,
        secretCiphertext: `enc:${secret}`,
      });

      const codes = await service.confirmEnrollment(
        'user-1',
        authenticator.generate(secret),
      );

      expect(secrets.markEnabled).toHaveBeenCalledWith('user-1');
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10);
      expect(tokens.save).toHaveBeenCalledTimes(10);
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-1', action: 'mfa.enabled' }),
      );
    });

    it('rejects an incorrect code without enabling', async () => {
      const { service, secrets } = setup();
      const secret = authenticator.generateSecret();
      secrets.findByUserId.mockResolvedValue({
        enabled: false,
        secretCiphertext: `enc:${secret}`,
      });

      await expect(
        service.confirmEnrollment('user-1', '000000'),
      ).rejects.toThrow(MfaCodeInvalidError);
      expect(secrets.markEnabled).not.toHaveBeenCalled();
    });

    it('rejects when there is no pending enrollment', async () => {
      const { service, secrets } = setup();
      secrets.findByUserId.mockResolvedValue(null);

      await expect(
        service.confirmEnrollment('user-1', '123456'),
      ).rejects.toThrow(MfaEnrollmentNotPendingError);
    });

    it('rejects re-confirming an already-enabled account', async () => {
      const { service, secrets } = setup();
      secrets.findByUserId.mockResolvedValue({ enabled: true });

      await expect(
        service.confirmEnrollment('user-1', '123456'),
      ).rejects.toThrow(MfaEnrollmentNotPendingError);
    });
  });

  describe('disable', () => {
    it('deletes the secret, invalidates recovery codes, and audits', async () => {
      const { service, secrets, tokens, audit } = setup();
      secrets.findByUserId.mockResolvedValue({ enabled: true });

      await service.disable('user-1');

      expect(secrets.deleteForUser).toHaveBeenCalledWith('user-1');
      expect(tokens.invalidateActiveForUser).toHaveBeenCalledWith(
        'user-1',
        AuthTokenPurpose.MFA_RECOVERY_CODE,
      );
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ actorId: 'user-1', action: 'mfa.disabled' }),
      );
    });

    it('rejects disabling when MFA is not enabled', async () => {
      const { service, secrets } = setup();
      secrets.findByUserId.mockResolvedValue(null);

      await expect(service.disable('user-1')).rejects.toThrow(
        MfaNotEnabledError,
      );
    });
  });

  describe('issueChallenge / verifyChallenge', () => {
    it('verifies a correct TOTP code and consumes the challenge exactly once', async () => {
      const { service, secrets, tokens } = setup();
      const secret = authenticator.generateSecret();
      secrets.findByUserId.mockResolvedValue({
        enabled: true,
        secretCiphertext: `enc:${secret}`,
      });

      const { challengeToken } = await service.issueChallenge('user-1');
      tokens.findActiveByHash.mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const userId = await service.verifyChallenge(
        challengeToken,
        authenticator.generate(secret),
      );

      expect(userId).toBe('user-1');
      expect(tokens.markUsedIfActive).toHaveBeenCalledWith('challenge-1');
    });

    it('leaves the challenge unconsumed on an incorrect code', async () => {
      const { service, secrets, tokens } = setup();
      const secret = authenticator.generateSecret();
      secrets.findByUserId.mockResolvedValue({
        enabled: true,
        secretCiphertext: `enc:${secret}`,
      });
      tokens.findActiveByHash.mockImplementation((_hash, purpose) => {
        if (purpose === AuthTokenPurpose.MFA_CHALLENGE) {
          return Promise.resolve({
            id: 'challenge-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 60_000),
          });
        }

        return Promise.resolve(null);
      });

      await expect(
        service.verifyChallenge('raw-token', '000000'),
      ).rejects.toThrow(MfaCodeInvalidError);
      expect(tokens.markUsedIfActive).not.toHaveBeenCalled();
    });

    it('rejects an unknown or expired challenge token', async () => {
      const { service, tokens } = setup();
      tokens.findActiveByHash.mockResolvedValue(null);

      await expect(service.verifyChallenge('bogus', '123456')).rejects.toThrow(
        MfaChallengeInvalidError,
      );
    });

    it('falls back to a valid recovery code when the TOTP code is wrong', async () => {
      const { service, secrets, tokens } = setup();
      const secret = authenticator.generateSecret();
      secrets.findByUserId.mockResolvedValue({
        enabled: true,
        secretCiphertext: `enc:${secret}`,
      });
      tokens.findActiveByHash.mockImplementation((_hash, purpose) => {
        if (purpose === AuthTokenPurpose.MFA_CHALLENGE) {
          return Promise.resolve({
            id: 'challenge-1',
            userId: 'user-1',
            expiresAt: new Date(Date.now() + 60_000),
          });
        }

        return Promise.resolve({ id: 'recovery-1', userId: 'user-1' });
      });

      const userId = await service.verifyChallenge(
        'raw-token',
        'a-recovery-code',
      );

      expect(userId).toBe('user-1');
      expect(tokens.markUsedIfActive).toHaveBeenCalledWith('recovery-1');
      expect(tokens.markUsedIfActive).toHaveBeenCalledWith('challenge-1');
    });
  });
});
