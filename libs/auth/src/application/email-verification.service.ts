import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@/database';
import { AuthTokenRepository } from '../domain/auth-token.repository';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import { UserRepository } from '../domain/user.repository';
import { UserStatus } from '../domain/user-status.enum';
import {
  AUTH_EVENT_PUBLISHER,
  AUTH_MODULE_OPTIONS,
  DEFAULT_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS,
} from '../auth.constants';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';
import type { AuthModuleOptions } from '../auth.types';
import { EmailVerificationTokenInvalidError } from '../errors/email-verification-token-invalid.error';

@Injectable()
export class EmailVerificationService {
  private readonly ttlSeconds: number;

  constructor(
    @InjectRepository(AuthTokenRepository)
    private readonly tokens: AuthTokenRepository,
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
    @Inject(AUTH_EVENT_PUBLISHER)
    private readonly events: AuthEventPublisher,
  ) {
    this.ttlSeconds =
      options.emailVerificationTokenTtlSeconds ??
      DEFAULT_EMAIL_VERIFICATION_TOKEN_TTL_SECONDS;
  }

  /**
   * Issues a fresh verification token and publishes it for the host app's
   * `AuthEventPublisher` to actually email — used both right after
   * registration and by `requestVerification`'s resend path, so both go
   * through the exact same issue-and-notify logic.
   */
  async issue(userId: string, email: string): Promise<void> {
    await this.tokens.invalidateActiveForUser(
      userId,
      AuthTokenPurpose.EMAIL_VERIFICATION,
    );

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.tokens.save({
      userId,
      purpose: AuthTokenPurpose.EMAIL_VERIFICATION,
      tokenHash: this.hash(token),
      expiresAt,
      createdAt: new Date(),
    });

    await this.events.publishEmailVerificationRequested({
      userId,
      email,
      token,
      expiresAt,
    });
  }

  /**
   * Silently no-ops for an unknown email or one that isn't currently
   * `UNVERIFIED` — same "don't leak account existence/state" reasoning as
   * `PasswordResetService.requestReset`.
   */
  async requestVerification(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.toLowerCase());

    if (!user || user.status !== UserStatus.UNVERIFIED) {
      return;
    }

    await this.issue(user.id, user.email);
  }

  async confirm(rawToken: string): Promise<void> {
    const record = await this.tokens.findActiveByHash(
      this.hash(rawToken),
      AuthTokenPurpose.EMAIL_VERIFICATION,
    );

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new EmailVerificationTokenInvalidError();
    }

    const consumed = await this.tokens.markUsedIfActive(record.id);

    if (!consumed) {
      throw new EmailVerificationTokenInvalidError();
    }

    const user = await this.users.findById(record.userId);

    if (!user) {
      throw new EmailVerificationTokenInvalidError();
    }

    // Only ever transitions UNVERIFIED -> ACTIVE, never stomps any other
    // status. `DISABLED` has no code path that sets it anywhere in this
    // library today, so this branch is currently unreachable — but a
    // verification link is long-lived (TTL-bound, not single-request-bound)
    // and this method's only job is "finish verifying an email," not
    // "reactivate an account." Unconditionally setting ACTIVE here would
    // silently undo a future admin-disable action for a user who still
    // holds a valid, unused, unexpired verification link from before they
    // were disabled.
    if (user.status !== UserStatus.UNVERIFIED) {
      throw new EmailVerificationTokenInvalidError();
    }

    await this.users.save({
      id: user.id,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
    });
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
