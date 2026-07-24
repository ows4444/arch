import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialAuditSchema1753600000000 implements MigrationInterface {
  name = 'InitialAuditSchema1753600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'audit_entries',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'actorId', type: 'varchar', isNullable: true },
          { name: 'action', type: 'varchar' },
          { name: 'targetType', type: 'varchar', isNullable: true },
          { name: 'targetId', type: 'varchar', isNullable: true },
          { name: 'metadata', type: 'json', isNullable: true },
          {
            name: 'createdAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'audit_entries',
      new TableIndex({ columnNames: ['actorId'] }),
    );

    await queryRunner.createIndex(
      'audit_entries',
      new TableIndex({ columnNames: ['targetType', 'targetId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('audit_entries');
  }
}
