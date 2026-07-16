import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('workflow_idempotency')
@Index(['workflowId'])
export class WorkflowIdempotencyEntity {
  @PrimaryColumn()
  key!: string;

  @Column()
  workflowId!: string;

  @Column()
  completed!: boolean;

  @Column({
    type: 'datetime',
  })
  createdAt!: Date;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  completedAt?: Date;
}
