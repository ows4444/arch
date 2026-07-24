import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@/database';
import { AuthTokenRepository } from '../domain/auth-token.repository';
import { AuthTokenPurpose } from '../domain/auth-token-purpose.enum';
import { UserRepository } from '../domain/user.repository';
import { RefreshTokenService } from './refresh-token.service';
import {
  AUTH_EVENT_PUBLISHER,
  AUTH_MODULE_OPTIONS,
  DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS,
  PASSWORD_HASHER,
} from '../auth.constants';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';
import type { AuthModuleOptions } from '../auth.types';
import type { PasswordHasher } from '../ports/password-hasher.interface';
import { PasswordResetTokenInvalidError } from '../errors/password-reset-token-invalid.error';

@Injectable()
export class PasswordResetService {
  private readonly ttlSeconds: number;

  constructor(
    @InjectRepository(AuthTokenRepository)
    private readonly tokens: AuthTokenRepository,
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenService,
    @Inject(PASSWORD_HASHER)
    private readonly passwordHasher: PasswordHasher,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
    @Inject(AUTH_EVENT_PUBLISHER)
    private readonly events: AuthEventPublisher,
  ) {
    this.ttlSeconds =
      options.passwordResetTokenTtlSeconds ??
      DEFAULT_PASSWORD_RESET_TOKEN_TTL_SECONDS;
  }

  /**
   * Silently no-ops for an unknown email — never reveals whether an
   * account exists via response timing/shape.
   */
  async requestReset(email: string): Promise<void> {
    const user = await this.users.findByEmail(email.toLowerCase());

    if (!user) {
      return;
    }

    await this.tokens.invalidateActiveForUser(
      user.id,
      AuthTokenPurpose.PASSWORD_RESET,
    );

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.tokens.save({
      userId: user.id,
      purpose: AuthTokenPurpose.PASSWORD_RESET,
      tokenHash: this.hash(token),
      expiresAt,
      createdAt: new Date(),
    });

    await this.events.publishPasswordResetRequested({
      userId: user.id,
      email: user.email,
      token,
      expiresAt,
    });
  }

  /**
   * Revokes every existing refresh token for the user on a successful
   * reset — a password reset is exactly the moment every other session
   * (including a possibly-compromised one) should be forced to
   * re-authenticate, same reasoning `AuthService.logoutAll` already exists
   * for.
   */
  async confirmReset(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.tokens.findActiveByHash(
      this.hash(rawToken),
      AuthTokenPurpose.PASSWORD_RESET,
    );

    if (!record || record.expiresAt.getTime() <= Date.now()) {
      throw new PasswordResetTokenInvalidError();
    }

    const consumed = await this.tokens.markUsedIfActive(record.id);

    if (!consumed) {
      throw new PasswordResetTokenInvalidError();
    }

    const user = await this.users.findById(record.userId);

    if (!user) {
      throw new PasswordResetTokenInvalidError();
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);

    await this.users.save({
      id: user.id,
      passwordHash,
      passwordAlgo: this.passwordHasher.algo,
    });

    await this.refreshTokens.revokeAllForUser(user.id);
    await this.events.publishPasswordChanged({ userId: user.id });
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
