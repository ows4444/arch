import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * Adds `workflow_executions.joinId`/`.joinPolicy`, backing the parallel
 * fan-out-fan-in primitive (`WorkflowStepResult.spawnChildren`/
 * `.joinPolicy`, `'waiting-children'` status). `joinId` is set both on a
 * parent while it waits and on each child spawned as part of that specific
 * fan-out episode, so join-quorum counting can be scoped correctly even if
 * a workflow also has ordinary `trigger: 'onStart'` children or fans out
 * more than once over its lifetime.
 */
export class WorkflowJoin1752500000000 implements MigrationInterface {
  name = 'WorkflowJoin1752500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'workflow_executions',
      new TableColumn({ name: 'joinId', type: 'varchar', isNullable: true }),
    );
    await queryRunner.addColumn(
      'workflow_executions',
      new TableColumn({ name: 'joinPolicy', type: 'json', isNullable: true }),
    );

    await queryRunner.createIndex(
      'workflow_executions',
      new TableIndex({
        name: 'IDX_workflow_executions_parentWorkflowId_joinId',
        columnNames: ['parentWorkflowId', 'joinId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex(
      'workflow_executions',
      'IDX_workflow_executions_parentWorkflowId_joinId',
    );
    await queryRunner.dropColumn('workflow_executions', 'joinPolicy');
    await queryRunner.dropColumn('workflow_executions', 'joinId');
  }
}
