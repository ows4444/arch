import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('workflow_step_history')
@Index(['workflowId'])
export class WorkflowStepHistoryEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  workflowId!: string;

  @Column()
  step!: string;

  @Column()
  status!: string;

  @Column({
    type: 'datetime',
  })
  startedAt!: Date;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  completedAt?: Date | undefined;

  @Column({
    type: 'int',
    nullable: true,
  })
  durationMs?: number | undefined;

  @Column({
    type: 'text',
    nullable: true,
  })
  error?: string | undefined;
}
