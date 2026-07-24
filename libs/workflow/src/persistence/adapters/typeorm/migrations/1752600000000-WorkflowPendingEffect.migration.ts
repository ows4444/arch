import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Adds `workflow_executions.pendingEffect`, a durable marker for a lifecycle
 * side-effect (spawning/cancelling children, scheduling a retry) deferred to
 * `afterCommit` but not yet confirmed to have run. Backs
 * `WorkflowAutoRecoveryService`'s replay sweep — see
 * `models/workflow-pending-effect.ts`.
 */
export class WorkflowPendingEffect1752600000000 implements MigrationInterface {
  name = 'WorkflowPendingEffect1752600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'workflow_executions',
      new TableColumn({
        name: 'pendingEffect',
        type: 'json',
        isNullable: true,
      }),
    );

    await queryRunner.createIndex(
      'workflow_executions',
      new TableIndex({
        name: 'IDX_workflow_executions_updatedAt',
        columnNames: ['updatedAt'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'workflow_executions',
      'IDX_workflow_executions_updatedAt',
    );
    await queryRunner.dropColumn('workflow_executions', 'pendingEffect');
  }
}
