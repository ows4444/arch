import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { InjectRepository } from '@/database';
import { ScheduledJob } from '@/scheduler';
import { RefreshTokenRepository } from '../domain/refresh-token.repository';
import {
  AUTH_EVENT_PUBLISHER,
  AUTH_MODULE_OPTIONS,
  DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER,
  DEFAULT_REFRESH_TOKEN_PURGE_GRACE_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from '../auth.constants';
import type { AuthEventPublisher } from '../ports/auth-event-publisher.interface';
import type { AuthModuleOptions } from '../auth.types';
import { TokenRevokedError } from '../errors/token-revoked.error';
import { SessionNotFoundError } from '../errors/session-not-found.error';

export interface RefreshTokenMetadata {
  createdByIp?: string;

  userAgent?: string;

  deviceId?: string;
}

export interface IssuedRefreshToken {
  token: string;

  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;

  refreshToken: IssuedRefreshToken;
}

/**
 * Deliberately omits `tokenHash`/`familyId`/`userId`/`revokedAt` — this is
 * what a "list my devices" endpoint returns to the owning user, not the raw
 * entity, so it can't leak the hash a stolen response would otherwise let
 * an attacker correlate against a captured raw token.
 */
export interface ActiveSession {
  id: string;

  createdByIp?: string | null;

  userAgent?: string | null;

  deviceId?: string | null;

  createdAt: Date;

  expiresAt: Date;
}

@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  private readonly ttlSeconds: number;

  private readonly maxActiveSessions: number;

  private readonly purgeGraceSeconds: number;

  constructor(
    @InjectRepository(RefreshTokenRepository)
    private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUTH_MODULE_OPTIONS) options: AuthModuleOptions,
    @Inject(AUTH_EVENT_PUBLISHER)
    private readonly events: AuthEventPublisher,
  ) {
    this.ttlSeconds =
      options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS;
    this.maxActiveSessions =
      options.maxActiveSessionsPerUser ?? DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER;
    this.purgeGraceSeconds =
      options.refreshTokenPurgeGraceSeconds ??
      DEFAULT_REFRESH_TOKEN_PURGE_GRACE_SECONDS;
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
      deviceId: metadata.deviceId ?? null,
      createdAt: new Date(),
    });

    await this.enforceSessionLimit(userId);

    return { token, expiresAt };
  }

  /**
   * Caps concurrent active sessions/devices per user at `maxActiveSessions`
   * — evicts the least-recently-issued active session(s) rather than
   * rejecting the new login (see `AuthModuleOptions.maxActiveSessionsPerUser`).
   * A no-op during token *rotation* (as opposed to a fresh `login()`):
   * `rotate()` already revokes the old row for that family before calling
   * `issue()` again, so the active count never actually grows on rotation —
   * only a genuinely new login (or a user already over the cap from before
   * this limit existed/changed) ever triggers an eviction here.
   */
  private async enforceSessionLimit(userId: string): Promise<void> {
    const active = await this.refreshTokens.findActiveForUser(userId);
    const excess = active.length - this.maxActiveSessions;

    if (excess > 0) {
      await this.refreshTokens.revokeMany(
        active.slice(0, excess).map((token) => token.id),
      );
    }
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

  async listActiveForUser(userId: string): Promise<ActiveSession[]> {
    const active = await this.refreshTokens.findActiveForUser(userId);

    return active.map((token) => ({
      id: token.id,
      createdByIp: token.createdByIp ?? null,
      userAgent: token.userAgent ?? null,
      deviceId: token.deviceId ?? null,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
    }));
  }

  /**
   * Revokes exactly one session by id, scoped to `userId` so a caller can
   * only ever revoke their own sessions — see
   * `RefreshTokenRepository.revokeIfActiveForUser`.
   */
  async revokeOne(userId: string, sessionId: string): Promise<void> {
    const revoked = await this.refreshTokens.revokeIfActiveForUser(
      sessionId,
      userId,
    );

    if (!revoked) {
      throw new SessionNotFoundError(sessionId);
    }
  }

  /**
   * Deletes revoked/expired `auth_refresh_tokens` rows once they're past the
   * purge grace window (see `deleteExpiredAndRevoked`'s doc for why a grace
   * window exists at all) — otherwise the table grows without bound, since
   * every prior mutation (`rotate`, `revoke`, `revokeAllForUser`,
   * `enforceSessionLimit`) only ever sets `revokedAt`, never deletes.
   */
  @ScheduledJob('auth.refresh-token-purge', '0 * * * *')
  async purgeExpiredTokens(): Promise<void> {
    const before = new Date(Date.now() - this.purgeGraceSeconds * 1000);
    const deleted = await this.refreshTokens.deleteExpiredAndRevoked(before);

    if (deleted > 0) {
      this.logger.log(`Purged ${deleted} expired/revoked refresh token(s).`);
    }
  }

  private hash(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
