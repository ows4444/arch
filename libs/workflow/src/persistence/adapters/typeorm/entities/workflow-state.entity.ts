import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import type { WorkflowExecutionState } from '../../../../models/workflow-execution-state';
import type { WorkflowFailure } from '../../../../models/workflow-failure';
import type { WorkflowJoinPolicy } from '../../../../models/workflow-join-policy';
import type { WorkflowSignal } from '../../../../models/workflow-signal';
import type { WorkflowStatus } from '../../../../types/workflow-status';

@Index(['status', 'waitingSince'])
@Index(['status', 'sleepUntil'])
@Index(['parentWorkflowId', 'joinId'])
@Index(['status'])
@Index(['status', 'stepStartedAt'])
@Index(['status', 'completedAt'])
@Index(['workflowId', 'stateVersion'])
@Index(['parentWorkflowId'])
@Index(['correlationId'])
@Index(['requiresRecovery', 'retryAt'])
@Entity('workflow_executions')
export class WorkflowStateEntity {
  @PrimaryColumn()
  workflowId!: string;

  @Column({ type: 'varchar', nullable: true })
  parentWorkflowId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  parentExecutionId?: string | null;

  @Column()
  executionId!: string;

  @Column()
  workflowName!: string;

  @Column()
  workflowVersion!: number;

  @Column({ type: 'varchar' })
  status!: WorkflowStatus;

  @Column({ type: 'varchar', nullable: true })
  currentStep?: string | null;

  @Column({ type: 'varchar', nullable: true })
  failedStep?: string | null;

  @Column({ type: 'json', nullable: true })
  lastFailure?: WorkflowFailure | null;

  @Column({ type: 'varchar', nullable: true })
  recoveryReason?: WorkflowExecutionState['recoveryReason'] | null;

  @Column({ type: 'json' })
  data!: Record<string, unknown>;

  @Column()
  historyCount!: number;

  @Column()
  correlationId!: string;

  @Column({ type: 'varchar', nullable: true })
  executingStep?: string | null;

  @Column({ type: 'varchar', nullable: true })
  resumeStep?: string | null;

  @Column({ type: 'int', nullable: true })
  stepRetryCount?: number | null;

  @Column({ nullable: true, type: 'json' })
  waitingForSignal?: WorkflowSignal | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  waitingSince?: Date | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  sleepUntil?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  joinId?: string | null;

  @Column({ type: 'json', nullable: true })
  joinPolicy?: WorkflowJoinPolicy | null;

  @Column()
  iteration!: number;

  @Column({ type: 'int', nullable: true })
  failureCount?: number | null;

  @Column({ type: 'boolean', nullable: true })
  requiresRecovery?: boolean | null;

  @Column({ type: 'int', nullable: true, default: 0 })
  recoveryAttempts?: number | null;

  @Column({ type: 'varchar', nullable: true })
  leaseOwner?: string | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  leaseExpiresAt?: Date | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  lastRecoveryAt?: Date | null;

  @Column({
    type: 'datetime',
    nullable: true,
  })
  retryAt?: Date | null;

  @Column({ type: 'datetime' })
  createdAt!: Date;

  @Column({ type: 'datetime' })
  updatedAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  completedAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  failedAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  stepStartedAt?: Date | null;

  @Column()
  stateVersion!: number;
}
