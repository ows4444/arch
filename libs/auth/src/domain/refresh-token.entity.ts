import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Index(['userId'])
@Entity('auth_refresh_tokens')
export class RefreshTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar', unique: true })
  tokenHash!: string;

  @Column({ type: 'varchar' })
  familyId!: string;

  @Column({ type: 'datetime' })
  expiresAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  revokedAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  createdByIp?: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string | null;

  /**
   * Client-supplied, opaque identifier (e.g. a UUID a mobile/web client
   * generates once and persists locally) — forensic/audit metadata only,
   * same status as `createdByIp`/`userAgent`. Not validated for uniqueness
   * or used in any lookup: a caller that doesn't send one simply leaves
   * this `null`, with no change to session-limit or rotation behavior.
   */
  @Column({ type: 'varchar', nullable: true })
  deviceId?: string | null;

  @Column({ type: 'datetime' })
  createdAt!: Date;
}
