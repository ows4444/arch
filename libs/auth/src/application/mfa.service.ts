import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { authenticator } from 'otplib';
import { InjectRepository } from '@/database';
import { AuditService } from '@/audit';
import { MfaSecretRepository } from '../domain/mfa-secret.repository';
import { AuthTokenRepository } from '../domain/auth-token.repository';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import {
  AUTH_MODULE_OPTIONS,
  DEFAULT_MFA_CHALLENGE_TTL_SECONDS,
  DEFAULT_MFA_RECOVERY_CODES_COUNT,
  MFA_SECRET_CIPHER,
} from '../auth.constants';
import type { AuthModuleOptions } from '../auth.types';
import type { MfaSecretCipher } from '../ports/mfa-secret-cipher.interface';
import { MfaAlreadyEnabledError } from '../errors/mfa-already-enabled.error';
import { MfaEnrollmentNotPendingError } from '../errors/mfa-enrollment-not-pending.error';
import { MfaChallengeInvalidError } from '../errors/mfa-challenge-invalid.error';
import { MfaCodeInvalidError } from '../errors/mfa-code-invalid.error';
import { MfaNotEnabledError } from '../errors/mfa-not-enabled.error';

export interface MfaEnrollment {
  secret: string;

  otpauthUrl: string;
}

/** Non-expiring in practice — a recovery code is only ever invalidated by being used or by MFA being disabled/re-enrolled. */
const RECOVERY_CODE_EXPIRES_AT = new Date('2099-01-01T00:00:00.000Z');

/**
 * TOTP-based MFA: enrollment (begin/confirm), disable, and the two calls
 * `AuthService`'s two-step login uses (`issueChallenge`/`verifyChallenge`).
 * See `libs/auth/ARCH.md` Design 009.
 */
@Injectable()
export class MfaService {
  private readonly challengeTtlSeconds: number;
  private readonly recoveryCodesCount: number;

  constructor(
    @InjectRepository(MfaSecretRepository)
    private readonly secrets: MfaSecretRepository,
    @InjectRepository(AuthTokenRepository)
    private readonly tokens: AuthTokenRepository,
    @Inject(MFA_SECRET_CIPHER)
    private readonly cipher: MfaSecretCipher,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
    private readonly audit: AuditService,
  ) {
    this.challengeTtlSeconds =
      options.mfa?.challengeTtlSeconds ?? DEFAULT_MFA_CHALLENGE_TTL_SECONDS;
    this.recoveryCodesCount =
      options.mfa?.recoveryCodesCount ?? DEFAULT_MFA_RECOVERY_CODES_COUNT;
  }

  async isEnabled(userId: string): Promise<boolean> {
    const record = await this.secrets.findByUserId(userId);

    return record?.enabled ?? false;
  }

  /**
   * Overwrites any previous pending (unconfirmed) secret — re-calling this
   * before confirming just restarts enrollment with a fresh secret, see
   * `MfaSecretRepository.upsertPending`.
   */
  async beginEnrollment(userId: string, email: string): Promise<MfaEnrollment> {
    if (await this.isEnabled(userId)) {
      throw new MfaAlreadyEnabledError();
    }

    const secret = authenticator.generateSecret();

    await this.secrets.upsertPending(userId, this.cipher.encrypt(secret));

    return { secret, otpauthUrl: authenticator.keyuri(email, 'ARCH', secret) };
  }

  /**
   * Recovery codes are shown to the caller exactly once, here — they're
   * stored only as hashes (via the shared `AuthTokenEntity`/
   * `AuthTokenPurpose.MFA_RECOVERY_CODE` single-use-token pattern), never
   * retrievable again after this call returns.
   */
  async confirmEnrollment(userId: string, code: string): Promise<string[]> {
    const record = await this.secrets.findByUserId(userId);

    if (!record || record.enabled) {
      throw new MfaEnrollmentNotPendingError();
    }

    const secret = this.cipher.decrypt(record.secretCiphertext);

    if (!authenticator.check(code, secret)) {
      throw new MfaCodeInvalidError();
    }

    await this.secrets.markEnabled(userId);

    const recoveryCodes = await this.issueRecoveryCodes(userId);

    await this.audit.record({
      actorId: userId,
      action: 'mfa.enabled',
      targetType: 'user',
      targetId: userId,
    });

    return recoveryCodes;
  }

  async disable(userId: string): Promise<void> {
    if (!(await this.isEnabled(userId))) {
      throw new MfaNotEnabledError();
    }

    await this.secrets.deleteForUser(userId);
    await this.tokens.invalidateActiveForUser(
      userId,
      AuthTokenPurpose.MFA_RECOVERY_CODE,
    );

    await this.audit.record({
      actorId: userId,
      action: 'mfa.disabled',
      targetType: 'user',
      targetId: userId,
    });
  }

  /** Called by `AuthService.login` once the password has already been verified, right before it would normally issue a session. */
  async issueChallenge(
    userId: string,
  ): Promise<{ challengeToken: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.challengeTtlSeconds * 1000);

    await this.tokens.save({
      userId,
      purpose: AuthTokenPurpose.MFA_CHALLENGE,
      tokenHash: this.hash(token),
      expiresAt,
      createdAt: new Date(),
    });

    return { challengeToken: token, expiresAt };
  }

  /**
   * Consumes the challenge token only on a *successful* code check — an
   * incorrect code leaves the challenge alive for another attempt within
   * its TTL (abuse is bounded by `@RateLimit('mfa-verify')` and the
   * challenge's own short TTL, not by single-shot consumption), unlike
   * `PasswordResetService`/`EmailVerificationService` where the token
   * itself *is* the whole credential.
   */
  async verifyChallenge(
    rawChallengeToken: string,
    code: string,
  ): Promise<string> {
    const record = await this.tokens.findActiveByHash(
      this.hash(rawChallengeToken),
      AuthTokenPurpose.MFA_CHALLENGE,
    );

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new MfaChallengeInvalidError();
    }

    const valid = await this.verifyCode(record.userId, code);

    if (!valid) {
      throw new MfaCodeInvalidError();
    }

    const consumed = await this.tokens.markUsedIfActive(record.id);

    if (!consumed) {
      throw new MfaChallengeInvalidError();
    }

    return record.userId;
  }

  private async verifyCode(userId: string, code: string): Promise<boolean> {
    const record = await this.secrets.findByUserId(userId);

    if (record?.enabled) {
      const secret = this.cipher.decrypt(record.secretCiphertext);

      if (authenticator.check(code, secret)) {
        return true;
      }
    }

    return this.verifyRecoveryCode(userId, code);
  }

  private async verifyRecoveryCode(
    userId: string,
    code: string,
  ): Promise<boolean> {
    const record = await this.tokens.findActiveByHash(
      this.hash(code),
      AuthTokenPurpose.MFA_RECOVERY_CODE,
    );

    if (!record || record.userId !== userId) {
      return false;
    }

    return this.tokens.markUsedIfActive(record.id);
  }

  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    await this.tokens.invalidateActiveForUser(
      userId,
      AuthTokenPurpose.MFA_RECOVERY_CODE,
    );

    const codes: string[] = [];

    for (let i = 0; i < this.recoveryCodesCount; i += 1) {
      const code = randomBytes(5).toString('hex');

      codes.push(code);

      await this.tokens.save({
        userId,
        purpose: AuthTokenPurpose.MFA_RECOVERY_CODE,
        tokenHash: this.hash(code),
        expiresAt: RECOVERY_CODE_EXPIRES_AT,
        createdAt: new Date(),
      });
    }

    return codes;
  }

  private hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }
}
