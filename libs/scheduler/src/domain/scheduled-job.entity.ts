import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ScheduledJobMisfirePolicy } from './scheduled-job-misfire-policy.enum';

/**
 * `name` is the primary key, not a separate synthetic id — it's already the
 * stable, developer-chosen identifier passed to `@ScheduledJob(...)`, and
 * nothing external ever references a job by a different id (no HTTP
 * surface exists in this library — see `libs/scheduler/ARCH.md` Design 001,
 * Key Decisions MEDIUM #1).
 */
@Index(['enabled', 'nextFireAt'])
@Entity('scheduled_jobs')
export class ScheduledJobEntity {
  @PrimaryColumn()
  name!: string;

  @Column()
  cronExpression!: string;

  @Column({ type: 'varchar', nullable: true })
  timezone?: string | null;

  @Column({ type: 'varchar' })
  misfirePolicy!: ScheduledJobMisfirePolicy;

  @Column()
  enabled!: boolean;

  @Column({ type: 'datetime' })
  nextFireAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  lastFiredAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  claimedBy?: string | null;

  @Column({ type: 'datetime', nullable: true })
  claimedAt?: Date | null;

  @Column({ type: 'datetime' })
  createdAt!: Date;

  @Column({ type: 'datetime' })
  updatedAt!: Date;
}
