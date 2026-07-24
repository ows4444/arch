import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * `userId` is a plain unique-indexed column, not a database foreign key into
 * `libs/auth`'s `auth_users` table — see `libs/users/ARCH.md` Design 001,
 * Rejected Alternatives / Key Decisions MEDIUM #1. This keeps `libs/users`
 * independently testable without bootstrapping `libs/auth`'s schema; every
 * `userId` this table ever receives is one an authenticated JWT already
 * vouched for.
 */
@Entity('user_profiles')
export class UserProfileEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  userId!: string;

  @Column({ type: 'varchar' })
  displayName!: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl?: string | null;

  @Column({ type: 'varchar', nullable: true })
  bio?: string | null;

  @Column({ type: 'varchar', nullable: true })
  locale?: string | null;

  @Column({ type: 'varchar', nullable: true })
  timezone?: string | null;

  @Column({ type: 'datetime', nullable: true })
  deactivatedAt?: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
