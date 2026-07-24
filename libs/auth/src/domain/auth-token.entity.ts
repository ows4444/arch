import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuthTokenPurpose } from './auth-token-purpose.enum';

/**
 * Backs both password reset and email verification — the two are
 * structurally identical (a single-use, hashed, expiring token scoped to a
 * user), differing only in `purpose` and in which service consumes them.
 * One table/entity avoids duplicating the same schema twice; see
 * `PasswordResetService`/`EmailVerificationService`.
 */
@Index(['userId', 'purpose'])
@Entity('auth_tokens')
export class AuthTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar' })
  purpose!: AuthTokenPurpose;

  @Column({ type: 'varchar', unique: true })
  tokenHash!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  usedAt?: Date | null;

  @Column({ type: 'datetime' })
  createdAt!: Date;
}
