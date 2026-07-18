import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('workflow_signals')
@Index(['workflowId', 'processed'])
export class WorkflowSignalEntity {
  // Composite primary key: signalId is caller-supplied (WorkflowClient.signal)
  // and only guaranteed unique within one workflow, not globally — a bare
  // signalId PK let two different workflows collide on a shared id.
  @PrimaryColumn()
  workflowId!: string;

  @PrimaryColumn()
  signalId!: string;

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
