import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Adds `workflow_executions.sleepUntil`, backing the durable-timer/sleep
 * primitive (`WorkflowStepResult.sleepUntil`/`.sleepMs`, `'sleeping'`
 * status). Deliberately a separate nullable column rather than reusing the
 * existing `retryAt` field, which already means "crashed and needs
 * recovery" — overloading it would make operational queries built on
 * `requiresRecovery` misreport intentionally-sleeping workflows as stuck.
 */
export class WorkflowSleepUntil1752300000000 implements MigrationInterface {
  name = 'WorkflowSleepUntil1752300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'workflow_executions',
      new TableColumn({
        name: 'sleepUntil',
        type: 'datetime',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'workflow_executions',
      new TableIndex({
        name: 'IDX_workflow_executions_status_sleepUntil',
        columnNames: ['status', 'sleepUntil'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'workflow_executions',
      'IDX_workflow_executions_status_sleepUntil',
    );
    await queryRunner.dropColumn('workflow_executions', 'sleepUntil');
  }
}
