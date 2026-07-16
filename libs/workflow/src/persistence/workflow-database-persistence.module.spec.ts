import { Test, TestingModule } from '@nestjs/testing';
import { DatabaseModule } from '@/database';

import {
  WORKFLOW_HISTORY_STORE,
  WORKFLOW_IDEMPOTENCY_STORE,
  WORKFLOW_SIGNAL_STORE,
  WORKFLOW_SNAPSHOT_STORE,
  WORKFLOW_STATE_STORE,
  WORKFLOW_TRANSACTION_RUNNER,
} from '../constants/workflow.tokens';
import { WORKFLOW_TYPEORM_ENTITIES } from './adapters/typeorm/entities';
import { TypeOrmWorkflowStateStore } from './adapters/typeorm/stores/typeorm-workflow-state.store';
import { TypeOrmWorkflowSignalStore } from './adapters/typeorm/stores/typeorm-workflow-signal.store';
import { TypeOrmWorkflowHistoryStore } from './adapters/typeorm/stores/typeorm-workflow-history.store';
import { TypeOrmWorkflowIdempotencyStore } from './adapters/typeorm/stores/typeorm-workflow-idempotency.store';
import { TypeOrmWorkflowSnapshotStore } from './adapters/typeorm/stores/typeorm-workflow-snapshot.store';
import { DatabaseWorkflowTransactionRunner } from './adapters/database/database-workflow-transaction-runner';
import { WorkflowDatabasePersistenceModule } from './workflow-database-persistence.module';

describe('WorkflowDatabasePersistenceModule (wired against a real DatabaseModule)', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        DatabaseModule.forRootAsync({
          entities: undefined,
          useFactory: () => ({
            writer: {
              host: 'localhost',
              username: 'test',
              password: 'test',
              database: 'test',
              port: 3306,
              entities: [...WORKFLOW_TYPEORM_ENTITIES],
            },
            readers: [],
            autoInitialize: false,
          }),
        }),
        WorkflowDatabasePersistenceModule,
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('resolves the transaction runner as the database-backed adapter', () => {
    expect(moduleRef.get(WORKFLOW_TRANSACTION_RUNNER)).toBeInstanceOf(
      DatabaseWorkflowTransactionRunner,
    );
  });

  it.each([
    [WORKFLOW_STATE_STORE, TypeOrmWorkflowStateStore],
    [WORKFLOW_SIGNAL_STORE, TypeOrmWorkflowSignalStore],
    [WORKFLOW_HISTORY_STORE, TypeOrmWorkflowHistoryStore],
    [WORKFLOW_IDEMPOTENCY_STORE, TypeOrmWorkflowIdempotencyStore],
    [WORKFLOW_SNAPSHOT_STORE, TypeOrmWorkflowSnapshotStore],
  ] as const)(
    'resolves %s with the WorkflowEntityManagerProvider seam satisfied',
    (token, expectedClass) => {
      expect(moduleRef.get(token)).toBeInstanceOf(expectedClass);
    },
  );
});
