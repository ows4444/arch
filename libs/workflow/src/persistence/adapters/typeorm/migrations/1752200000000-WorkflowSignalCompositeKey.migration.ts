import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `workflow_signals.signalId` was the sole primary key, but signalId is
 * caller-supplied (`WorkflowClient.signal`) and only guaranteed unique
 * within one workflow — a bare signalId PK let two different workflows
 * collide on a shared id (e.g. both using `"approve"`), silently dropping
 * one workflow's signal while its state machine advanced as if it landed.
 * This migrates the primary key to the composite `(workflowId, signalId)`.
 */
export class WorkflowSignalCompositeKey1752200000000 implements MigrationInterface {
  name = 'WorkflowSignalCompositeKey1752200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `workflow_signals` DROP PRIMARY KEY');
    await queryRunner.query(
      'ALTER TABLE `workflow_signals` ADD PRIMARY KEY (`workflowId`, `signalId`)',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE `workflow_signals` DROP PRIMARY KEY');
    await queryRunner.query(
      'ALTER TABLE `workflow_signals` ADD PRIMARY KEY (`signalId`)',
    );
  }
}
