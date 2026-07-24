import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialOrganizationsSchema1753700000000 implements MigrationInterface {
  name = 'InitialOrganizationsSchema1753700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'organizations',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'name', type: 'varchar' },
          {
            name: 'createdAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'memberships',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'organizationId', type: 'varchar' },
          { name: 'userId', type: 'varchar' },
          { name: 'role', type: 'varchar' },
          {
            name: 'createdAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
        foreignKeys: [
          {
            columnNames: ['organizationId'],
            referencedTableName: 'organizations',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createIndex(
      'memberships',
      new TableIndex({
        name: 'IDX_memberships_organizationId_userId',
        columnNames: ['organizationId', 'userId'],
        isUnique: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('memberships');
    await queryRunner.dropTable('organizations');
  }
}
