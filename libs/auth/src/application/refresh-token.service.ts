import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { InjectRepository } from '@/database';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import {
  AUTH_EVENT_PUBLISHER,
  AUTH_MODULE_OPTIONS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from '../auth.constants';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';
import type { AuthModuleOptions } from '../auth.types';
import { TokenRevokedError } from '../errors/token-revoked.error';

export interface RefreshTokenMetadata {
  createdByIp?: string;

  userAgent?: string;
}

export interface IssuedRefreshToken {
  token: string;

  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;

  refreshToken: IssuedRefreshToken;
}

@Injectable()
export class RefreshTokenService {
  private readonly ttlSeconds: number;

  constructor(
    @InjectRepository(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
    @Inject(AUTH_EVENT_PUBLISHER)
    private readonly events: AuthEventPublisher,
  ) {
    this.ttlSeconds =
      options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
  }

  async issue(
    userId: string,
    metadata: RefreshTokenMetadata = {},
    familyId: string = randomUUID(),
  ): Promise<IssuedRefreshToken> {
    const token = randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    await this.refreshTokens.save({
      userId,
      tokenHash: this.hash(token),
      familyId,
      expiresAt,
      createdByIp: metadata.createdByIp ?? null,
      userAgent: metadata.userAgent ?? null,
      createdAt: new Date(),
    });

    return { token, expiresAt };
  }

  /**
   * Rotates a refresh token. Reuse of an already-rotated token — the
   * signature of a stolen token being replayed after the legitimate owner
   * rotated it — revokes the entire token family rather than just rejecting
   * the one request (see libs/auth/ARCH.md, Key Decisions HIGH #3).
   */
  async rotate(
    rawToken: string,
    metadata: RefreshTokenMetadata = {},
  ): Promise<RotatedRefreshToken> {
    const existing = await this.refreshTokens.findByTokenHash(
      this.hash(rawToken),
    );

    if (!existing) {
      throw new TokenRevokedError(
        'Refresh token is invalid or has already been used.',
      );
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new TokenRevokedError('Refresh token has expired.');
    }

    // Atomic compare-and-revoke: if this call didn't win the race to revoke
    // it, either `existing.revokedAt` was already set or a concurrent
    // `rotate()` beat us to it — both mean the token is being replayed, so
    // both are treated as reuse.
    const revoked = await this.refreshTokens.revokeIfActive(existing.id);

    if (!revoked) {
      await this.refreshTokens.revokeFamily(existing.familyId);
      await this.events.publishRefreshTokenReuseDetected({
        userId: existing.userId,
        familyId: existing.familyId,
      });

      throw new TokenRevokedError(
        'Refresh token reuse detected; all sessions in this chain have been revoked.',
      );
    }

    const refreshToken = await this.issue(
      existing.userId,
      metadata,
      existing.familyId,
    );

    return { userId: existing.userId, refreshToken };
  }

  async revoke(rawToken: string): Promise<void> {
    const existing = await this.refreshTokens.findByTokenHash(
      this.hash(rawToken),
    );

    if (!existing || existing.revokedAt) {
      return;
    }

    await this.refreshTokens.update(
      { id: existing.id },
      { revokedAt: new Date() },
    );
  }

  revokeAllForUser(userId: string): Promise<void> {
    return this.refreshTokens.revokeAllForUser(userId);
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
