import { Entity, Index, PrimaryGeneratedColumn, Column } from 'typeorm';
import type { WorkflowExecutionState } from '../../../../models/workflow-execution-state';

@Entity('workflow_snapshots')
@Index(['workflowId'], { unique: true })
export class WorkflowSnapshotEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  workflowId!: string;

  @Column()
  workflowName!: string;

  @Column()
  workflowVersion!: number;

  @Column()
  stateVersion!: number;

  @Column()
  historyCount!: number;

  @Column({
    type: 'simple-json',
  })
  state!: WorkflowExecutionState;

  @Column({
    type: 'datetime',
  })
  createdAt!: Date;
}
