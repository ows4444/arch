import { In, IsNull, MoreThan } from 'typeorm';
import { BaseRepository, DatabaseRepository } from '@/database';
import { RefreshTokenEntity } from './refresh-token.entity';

@DatabaseRepository(RefreshTokenEntity)
export class RefreshTokenRepository extends BaseRepository<RefreshTokenEntity> {
  protected readonly entity = RefreshTokenEntity;

  findByTokenHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    return this.findOneBy({ tokenHash });
  }

  /**
   * Atomically revokes a token only if it's still active (`revokedAt IS
   * NULL`), returning whether this call was the one that revoked it.
   * `false` means someone else already revoked it — including a concurrent
   * rotation of the same token, the exact race `RefreshTokenService.rotate`
   * treats as reuse (see libs/auth/ARCH.md, Key Decisions HIGH #3).
   */
  async revokeIfActive(id: string): Promise<boolean> {
    const result = await this.update(
      { id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Same atomic compare-and-revoke as `revokeIfActive`, additionally scoped
   * to `userId` — the only path a session-revoke-by-id endpoint needs
   * (see `RefreshTokenService.revokeOne`): a caller revoking someone else's
   * session id, or their own already-revoked/expired one, both come back
   * `false` and both are reported identically (a 404), so neither leaks
   * whether the id belongs to another user.
   */
  async revokeIfActiveForUser(id: string, userId: string): Promise<boolean> {
    const result = await this.update(
      { id, userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.update({ familyId }, { revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.update({ userId }, { revokedAt: new Date() });
  }

  /**
   * Active meaning not revoked *and* not naturally expired — an
   * old, never-explicitly-revoked token past its own `expiresAt` shouldn't
   * count against `maxActiveSessionsPerUser`, or every account would
   * eventually accumulate enough dead rows to start evicting genuinely
   * active sessions. Oldest first, so the caller can evict from the front.
   */
  findActiveForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<RefreshTokenEntity[]> {
    return this.find({
      where: { userId, revokedAt: IsNull(), expiresAt: MoreThan(now) },
      order: { createdAt: 'ASC' },
    });
  }

  async revokeMany(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }

    await this.update({ id: In(ids) }, { revokedAt: new Date() });
  }

  /**
   * Deletes rows that are both dead (revoked, or naturally expired) *and*
   * past `before` — the grace window `RefreshTokenService.purgeExpiredTokens`
   * applies so a token that was just revoked (e.g. by `rotate()`'s reuse
   * detection) isn't deleted before `findByTokenHash` has a chance to
   * observe it as "already revoked" and report reuse; deleting it instantly
   * would silently swap the "reuse detected, family revoked" error for a
   * generic "invalid token" one on the next replay attempt.
   */
  async deleteExpiredAndRevoked(before: Date): Promise<number> {
    return this.runWrite(async () => {
      const result = await this.repository
        .createQueryBuilder()
        .delete()
        .where('(revokedAt IS NOT NULL AND revokedAt < :before)', { before })
        .orWhere('expiresAt < :before', { before })
        .execute();

      return result.affected ?? 0;
    });
  }
}
