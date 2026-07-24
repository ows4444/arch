import { BaseRepository, DatabaseRepository } from '@/database';
import { MfaSecretEntity } from './mfa-secret.entity';

@DatabaseRepository(MfaSecretEntity)
export class MfaSecretRepository extends BaseRepository<MfaSecretEntity> {
  protected readonly entity = MfaSecretEntity;

  findByUserId(userId: string): Promise<MfaSecretEntity | null> {
    return this.findOneBy({ userId });
  }

  /**
   * Creates the pending row on first enrollment, or overwrites the
   * previous pending secret on a re-attempt — `userId` is unique, so this
   * is always exactly one row per user regardless of how many times
   * enrollment is (re)started before being confirmed. Find-then-save
   * rather than `upsert()`: `upsert()` builds a raw INSERT that bypasses
   * TypeORM's `@CreateDateColumn`/`@UpdateDateColumn` population (they
   * have no DB-level default), which fails on MySQL — no other repository
   * in this codebase uses `upsert()` for the same reason.
   */
  async upsertPending(userId: string, secretCiphertext: string): Promise<void> {
    const existing = await this.findByUserId(userId);

    await this.save({
      ...(existing ? { id: existing.id } : {}),
      userId,
      secretCiphertext,
      enabled: false,
    });
  }

  async markEnabled(userId: string): Promise<void> {
    await this.update({ userId }, { enabled: true });
  }

  async deleteForUser(userId: string): Promise<void> {
    await this.delete({ userId });
  }
}
