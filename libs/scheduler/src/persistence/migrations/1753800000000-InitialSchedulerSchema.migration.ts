import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialSchedulerSchema1753800000000 implements MigrationInterface {
  name = 'InitialSchedulerSchema1753800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'scheduled_jobs',
        columns: [
          { name: 'name', type: 'varchar', isPrimary: true },
          { name: 'cronExpression', type: 'varchar' },
          { name: 'timezone', type: 'varchar', isNullable: true },
          { name: 'misfirePolicy', type: 'varchar' },
          { name: 'enabled', type: 'boolean' },
          { name: 'nextFireAt', type: 'datetime' },
          { name: 'lastFiredAt', type: 'datetime', isNullable: true },
          { name: 'claimedBy', type: 'varchar', isNullable: true },
          { name: 'claimedAt', type: 'datetime', isNullable: true },
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

    await queryRunner.createIndex(
      'scheduled_jobs',
      new TableIndex({
        name: 'IDX_scheduled_jobs_enabled_nextFireAt',
        columnNames: ['enabled', 'nextFireAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('scheduled_jobs');
  }
}
