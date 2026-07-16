import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('workflow_signals')
@Index(['workflowId', 'processed'])
export class WorkflowSignalEntity {
  @PrimaryColumn()
  signalId!: string;

  @Column()
  workflowId!: string;

  @Column()
  signalName!: string;

  @Column({
    type: 'json',
    nullable: true,
  })
  payload?: unknown;

  @Column()
  processed!: boolean;

  @Column({
    type: 'datetime',
  })
  createdAt!: Date;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  processedAt?: Date | undefined;
}
