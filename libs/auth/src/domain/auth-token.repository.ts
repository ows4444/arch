import { IsNull } from 'typeorm';
import { BaseRepository, DatabaseRepository } from '@/database';
import { AuthTokenEntity } from './auth-token.entity';
import { AuthTokenPurpose } from './auth-token-purpose.enum';

@DatabaseRepository(AuthTokenEntity)
export class AuthTokenRepository extends BaseRepository<AuthTokenEntity> {
  protected readonly entity = AuthTokenEntity;

  findActiveByHash(
    tokenHash: string,
    purpose: AuthTokenPurpose,
  ): Promise<AuthTokenEntity | null> {
    return this.findOneBy({ tokenHash, purpose, usedAt: IsNull() });
  }

  /**
   * Atomically consumes a token only if it's still active (`usedAt IS
   * NULL`), returning whether this call was the one that consumed it —
   * same compare-and-set shape as `RefreshTokenRepository.revokeIfActive`,
   * so a token can't be redeemed twice under a concurrent double-submit.
   */
  async markUsedIfActive(id: string): Promise<boolean> {
    const result = await this.update(
      { id, usedAt: IsNull() },
      { usedAt: new Date() },
    );

    return (result.affected ?? 0) > 0;
  }

  /**
   * Invalidates any outstanding token of this purpose for the user before
   * issuing a new one, so requesting a fresh reset/verification link
   * doesn't leave older still-valid links floating around.
   */
  async invalidateActiveForUser(
    userId: string,
    purpose: AuthTokenPurpose,
  ): Promise<void> {
    await this.update(
      { userId, purpose, usedAt: IsNull() },
      { usedAt: new Date() },
    );
  }
}
