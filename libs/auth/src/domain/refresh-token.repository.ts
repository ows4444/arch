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
}
