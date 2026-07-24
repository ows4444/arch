import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MembershipRole } from './membership-role.enum';

/**
 * `userId` is a plain unique-indexed column (scoped by the composite index
 * below), not a database foreign key into `libs/users`/`libs/auth` — same
 * cross-domain-lib reasoning `libs/users/ARCH.md` Design 001 already gave
 * for its own `userId` column. `organizationId` *is* a real foreign key
 * (`onDelete: 'CASCADE'`) since `Organization` is owned within this same
 * library — see `libs/organizations/ARCH.md` Design 001, Domain Model.
 */
@Entity('memberships')
@Index(['organizationId', 'userId'], { unique: true })
export class MembershipEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  organizationId!: string;

  @Column({ type: 'varchar' })
  userId!: string;

  @Column({ type: 'varchar' })
  role!: MembershipRole;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt!: Date;
}
