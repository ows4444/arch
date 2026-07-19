import { IsNull } from 'typeorm';
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
}
