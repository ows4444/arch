import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialWorkflowSchema1752000000000 implements MigrationInterface {
  name = 'InitialWorkflowSchema1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'workflow_executions',
        columns: [
          { name: 'workflowId', type: 'varchar', isPrimary: true },
          { name: 'parentWorkflowId', type: 'varchar', isNullable: true },
          { name: 'parentExecutionId', type: 'varchar', isNullable: true },
          { name: 'executionId', type: 'varchar' },
          { name: 'workflowName', type: 'varchar' },
          { name: 'workflowVersion', type: 'int' },
          { name: 'status', type: 'varchar' },
          { name: 'currentStep', type: 'varchar', isNullable: true },
          { name: 'failedStep', type: 'varchar', isNullable: true },
          { name: 'lastFailure', type: 'json', isNullable: true },
          { name: 'recoveryReason', type: 'varchar', isNullable: true },
          { name: 'data', type: 'json' },
          { name: 'historyCount', type: 'int' },
          { name: 'correlationId', type: 'varchar' },
          { name: 'executingStep', type: 'varchar', isNullable: true },
          { name: 'resumeStep', type: 'varchar', isNullable: true },
          { name: 'stepRetryCount', type: 'int', isNullable: true },
          { name: 'waitingForSignal', type: 'json', isNullable: true },
          { name: 'waitingSince', type: 'datetime', isNullable: true },
          { name: 'iteration', type: 'int' },
          { name: 'failureCount', type: 'int', isNullable: true },
          { name: 'requiresRecovery', type: 'boolean', isNullable: true },
          {
            name: 'recoveryAttempts',
            type: 'int',
            isNullable: true,
            default: 0,
          },
          { name: 'leaseOwner', type: 'varchar', isNullable: true },
          { name: 'leaseExpiresAt', type: 'datetime', isNullable: true },
          { name: 'lastRecoveryAt', type: 'datetime', isNullable: true },
          { name: 'retryAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
          { name: 'updatedAt', type: 'datetime' },
          { name: 'completedAt', type: 'datetime', isNullable: true },
          { name: 'failedAt', type: 'datetime', isNullable: true },
          { name: 'stepStartedAt', type: 'datetime', isNullable: true },
          { name: 'stateVersion', type: 'int' },
        ],
      }),
    );

    await queryRunner.createIndices('workflow_executions', [
      new TableIndex({ columnNames: ['status', 'waitingSince'] }),
      new TableIndex({ columnNames: ['status'] }),
      new TableIndex({ columnNames: ['status', 'stepStartedAt'] }),
      new TableIndex({ columnNames: ['status', 'completedAt'] }),
      new TableIndex({ columnNames: ['workflowId', 'stateVersion'] }),
      new TableIndex({ columnNames: ['parentWorkflowId'] }),
      new TableIndex({ columnNames: ['correlationId'] }),
      new TableIndex({ columnNames: ['requiresRecovery', 'retryAt'] }),
    ]);

    await queryRunner.createTable(
      new Table({
        name: 'workflow_idempotency',
        columns: [
          { name: 'key', type: 'varchar', isPrimary: true },
          { name: 'workflowId', type: 'varchar' },
          { name: 'completed', type: 'boolean' },
          { name: 'createdAt', type: 'datetime' },
          { name: 'completedAt', type: 'datetime', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'workflow_idempotency',
      new TableIndex({ columnNames: ['workflowId'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'workflow_signals',
        columns: [
          { name: 'signalId', type: 'varchar', isPrimary: true },
          { name: 'workflowId', type: 'varchar' },
          { name: 'signalName', type: 'varchar' },
          { name: 'payload', type: 'json', isNullable: true },
          { name: 'processed', type: 'boolean' },
          { name: 'createdAt', type: 'datetime' },
          { name: 'processedAt', type: 'datetime', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'workflow_signals',
      new TableIndex({ columnNames: ['workflowId', 'processed'] }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'workflow_snapshots',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'workflowId', type: 'varchar' },
          { name: 'workflowName', type: 'varchar' },
          { name: 'workflowVersion', type: 'int' },
          { name: 'stateVersion', type: 'int' },
          { name: 'historyCount', type: 'int' },
          { name: 'state', type: 'text' },
          { name: 'createdAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'workflow_snapshots',
      new TableIndex({ columnNames: ['workflowId'], isUnique: true }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'workflow_step_history',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'workflowId', type: 'varchar' },
          { name: 'step', type: 'varchar' },
          { name: 'status', type: 'varchar' },
          { name: 'startedAt', type: 'datetime' },
          { name: 'completedAt', type: 'datetime', isNullable: true },
          { name: 'durationMs', type: 'int', isNullable: true },
          { name: 'error', type: 'text', isNullable: true },
        ],
      }),
    );

    await queryRunner.createIndex(
      'workflow_step_history',
      new TableIndex({ columnNames: ['workflowId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('workflow_step_history');
    await queryRunner.dropTable('workflow_snapshots');
    await queryRunner.dropTable('workflow_signals');
    await queryRunner.dropTable('workflow_idempotency');
    await queryRunner.dropTable('workflow_executions');
  }
}
