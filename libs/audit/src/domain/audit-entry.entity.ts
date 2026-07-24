import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only: nothing in this library ever updates or deletes a row, so
 * there is no `updatedAt` — `createdAt` is the only timestamp that will
 * ever matter. `actorId` is nullable to leave room for a future
 * system-initiated action with no acting user; neither current consumer
 * (`libs/auth`, `libs/users`) needs that today.
 */
@Entity('audit_entries')
export class AuditEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', nullable: true })
  actorId?: string | null;

  @Column({ type: 'varchar' })
  action!: string;

  @Column({ type: 'varchar', nullable: true })
  targetType?: string | null;

  @Column({ type: 'varchar', nullable: true })
  targetId?: string | null;

  @Column({ type: 'json', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'datetime' })
  createdAt!: Date;
}
