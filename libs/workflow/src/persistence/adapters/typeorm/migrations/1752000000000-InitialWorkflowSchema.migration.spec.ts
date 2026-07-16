import { DataSource } from 'typeorm';
import { InitialWorkflowSchema1752000000000 } from './1752000000000-InitialWorkflowSchema.migration';
import { WorkflowStateEntity } from '../entities/workflow-state.entity';
import { WorkflowIdempotencyEntity } from '../entities/workflow-idempotency.entity';
import { WorkflowSignalEntity } from '../entities/workflow-signal.entity';
import { WorkflowSnapshotEntity } from '../entities/workflow-snapshot.entity';
import { WorkflowStepHistoryEntity } from '../entities/workflow-step-history.entity';

describe('InitialWorkflowSchema migration', () => {
  it('creates all five tables on up() and drops them all on down()', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [
        WorkflowStateEntity,
        WorkflowIdempotencyEntity,
        WorkflowSignalEntity,
        WorkflowSnapshotEntity,
        WorkflowStepHistoryEntity,
      ],
      migrations: [InitialWorkflowSchema1752000000000],
      synchronize: false,
    });

    await dataSource.initialize();

    const tables = [
      'workflow_executions',
      'workflow_idempotency',
      'workflow_signals',
      'workflow_snapshots',
      'workflow_step_history',
    ];

    await dataSource.runMigrations();

    const queryRunner = dataSource.createQueryRunner();

    for (const table of tables) {
      expect(await queryRunner.hasTable(table)).toBe(true);
    }

    const stateRepo = dataSource.getRepository(WorkflowStateEntity);
    await stateRepo.insert({
      workflowId: 'wf-1',
      executionId: 'exec-1',
      workflowName: 'test',
      workflowVersion: 1,
      status: 'running',
      data: {},
      historyCount: 0,
      correlationId: 'corr-1',
      iteration: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      stateVersion: 1,
    });
    const loaded = await stateRepo.findOneBy({ workflowId: 'wf-1' });
    expect(loaded?.workflowName).toBe('test');

    await dataSource.undoLastMigration();

    for (const table of tables) {
      expect(await queryRunner.hasTable(table)).toBe(false);
    }

    await queryRunner.release();
    await dataSource.destroy();
  });
});
