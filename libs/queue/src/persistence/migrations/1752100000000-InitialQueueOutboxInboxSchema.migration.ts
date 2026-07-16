import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialQueueOutboxInboxSchema1752100000000 implements MigrationInterface {
  name = 'InitialQueueOutboxInboxSchema1752100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'queue_outbox',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'messageId', type: 'varchar' },
          { name: 'exchange', type: 'varchar' },
          { name: 'routingKey', type: 'varchar' },
          { name: 'payload', type: 'json' },
          { name: 'headers', type: 'json', isNullable: true },
          { name: 'status', type: 'varchar', default: "'pending'" },
          { name: 'attempts', type: 'int', default: 0 },
          { name: 'lastError', type: 'text', isNullable: true },
          { name: 'claimedBy', type: 'varchar', isNullable: true },
          { name: 'claimedAt', type: 'datetime', isNullable: true },
          { name: 'nextAttemptAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
          { name: 'publishedAt', type: 'datetime', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'queue_outbox',
      new TableIndex({ columnNames: ['status', 'nextAttemptAt'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'queue_inbox',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'consumerKey', type: 'varchar' },
          { name: 'messageId', type: 'varchar' },
          { name: 'processedAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'queue_inbox',
      new TableIndex({ columnNames: ['consumerKey', 'messageId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('queue_inbox');
    await queryRunner.dropTable('queue_outbox');
  }
}
