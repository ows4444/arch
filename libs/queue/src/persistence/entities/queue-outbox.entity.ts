import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type QueueOutboxStatus =
  'pending' | 'publishing' | 'published' | 'failed';

@Index(['status', 'nextAttemptAt'])
@Entity('queue_outbox')
export class QueueOutboxEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  messageId!: string;

  @Column()
  exchange!: string;

  @Column()
  routingKey!: string;

  @Column({ type: 'json' })
  payload!: unknown;

  @Column({ type: 'json', nullable: true })
  headers?: Record<string, string> | null;

  @Column({ type: 'varchar', default: 'pending' })
  status!: QueueOutboxStatus;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ type: 'text', nullable: true })
  lastError?: string | null;

  @Column({ type: 'varchar', nullable: true })
  claimedBy?: string | null;

  @Column({ type: 'datetime', nullable: true })
  claimedAt?: Date | null;

  @Column({ type: 'datetime', nullable: true })
  nextAttemptAt?: Date | null;

  @Column({ type: 'datetime' })
  createdAt!: Date;

  @Column({ type: 'datetime', nullable: true })
  publishedAt?: Date | null;
}
