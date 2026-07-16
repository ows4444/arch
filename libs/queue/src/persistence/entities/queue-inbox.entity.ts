import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Index(['consumerKey', 'messageId'])
@Entity('queue_inbox')
export class QueueInboxEntity {
  @PrimaryColumn()
  id!: string;

  @Column()
  consumerKey!: string;

  @Column()
  messageId!: string;

  @Column({ type: 'datetime' })
  processedAt!: Date;
}
