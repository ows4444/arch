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

  @Column({ type: 'datetime' })
  createdAt!: Date;
}
