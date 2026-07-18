import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Adds `workflow_schedules`, backing the cron-triggered-workflow primitive
 * (`WorkflowClient.schedule()`/`.unschedule()`/`.schedules()`,
 * `WorkflowSchedulerService`).
 */
export class WorkflowSchedule1752400000000 implements MigrationInterface {
  name = 'WorkflowSchedule1752400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'workflow_schedules',
        columns: [
          { name: 'scheduleId', type: 'varchar', isPrimary: true },
          { name: 'workflowName', type: 'varchar' },
          { name: 'workflowVersion', type: 'int', isNullable: true },
          { name: 'cronExpression', type: 'varchar' },
          { name: 'timezone', type: 'varchar', isNullable: true },
          { name: 'inputTemplate', type: 'json' },
          { name: 'enabled', type: 'boolean' },
          { name: 'nextFireAt', type: 'datetime' },
          { name: 'misfirePolicy', type: 'varchar' },
          { name: 'lastFiredAt', type: 'datetime', isNullable: true },
          { name: 'claimedBy', type: 'varchar', isNullable: true },
          { name: 'claimedAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
          { name: 'updatedAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'workflow_schedules',
      new TableIndex({
        name: 'IDX_workflow_schedules_enabled_nextFireAt',
        columnNames: ['enabled', 'nextFireAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('workflow_schedules');
  }
}
