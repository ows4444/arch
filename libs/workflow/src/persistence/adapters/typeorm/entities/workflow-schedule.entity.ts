import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { WorkflowScheduleMisfirePolicy } from '../../../../models/workflow-schedule';

@Index(['enabled', 'nextFireAt'])
@Entity('workflow_schedules')
export class WorkflowScheduleEntity {
  @PrimaryColumn()
  scheduleId!: string;

  @Column()
  workflowName!: string;

  @Column({ type: 'int', nullable: true })
  workflowVersion?: number | null;

  @Column()
  cronExpression!: string;

  @Column({ type: 'varchar', nullable: true })
  timezone?: string | null;

  @Column({ type: 'json' })
  inputTemplate!: Record<string, unknown>;

  @Column()
  enabled!: boolean;

  @Column({ type: 'datetime' })
  nextFireAt!: Date;

  @Column({ type: 'varchar' })
  misfirePolicy!: WorkflowScheduleMisfirePolicy;

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
