import { Module } from '@nestjs/common';

import {
  WORKFLOW_ENTITY_MANAGER_PROVIDER,
  WORKFLOW_HISTORY_STORE,
  WORKFLOW_IDEMPOTENCY_STORE,
  WORKFLOW_QUERY_STORE,
  WORKFLOW_SCHEDULE_STORE,
  WORKFLOW_SIGNAL_STORE,
  WORKFLOW_SNAPSHOT_STORE,
  WORKFLOW_STATE_STORE,
  WORKFLOW_TRANSACTION_RUNNER,
} from '../constants/workflow.tokens';
import { DatabaseWorkflowEntityManagerProvider } from './adapters/database/database-workflow-entity-manager.provider';
import { DatabaseWorkflowTransactionRunner } from './adapters/database/database-workflow-transaction-runner';
import { TypeOrmWorkflowHistoryStore } from './adapters/typeorm/stores/typeorm-workflow-history.store';
import { TypeOrmWorkflowIdempotencyStore } from './adapters/typeorm/stores/typeorm-workflow-idempotency.store';
import { TypeOrmWorkflowScheduleStore } from './adapters/typeorm/stores/typeorm-workflow-schedule.store';
import { TypeOrmWorkflowSignalStore } from './adapters/typeorm/stores/typeorm-workflow-signal.store';
import { TypeOrmWorkflowStateStore } from './adapters/typeorm/stores/typeorm-workflow-state.store';
import { TypeOrmWorkflowSnapshotStore } from './adapters/typeorm/stores/typeorm-workflow-snapshot.store';
import { NoopWorkflowSnapshotStore } from './noop-snapshot.store';
import { WorkflowPersistenceService } from './workflow-persistence.service';

@Module({
  providers: [
    DatabaseWorkflowEntityManagerProvider,
    DatabaseWorkflowTransactionRunner,

    {
      provide: WORKFLOW_ENTITY_MANAGER_PROVIDER,
      useExisting: DatabaseWorkflowEntityManagerProvider,
    },
    {
      provide: WORKFLOW_TRANSACTION_RUNNER,
      useExisting: DatabaseWorkflowTransactionRunner,
    },

    TypeOrmWorkflowStateStore,
    TypeOrmWorkflowSignalStore,
    TypeOrmWorkflowHistoryStore,
    TypeOrmWorkflowIdempotencyStore,
    TypeOrmWorkflowSnapshotStore,
    TypeOrmWorkflowScheduleStore,
    WorkflowPersistenceService,
    NoopWorkflowSnapshotStore,

    {
      provide: WORKFLOW_QUERY_STORE,
      useExisting: TypeOrmWorkflowStateStore,
    },
    {
      provide: WORKFLOW_IDEMPOTENCY_STORE,
      useExisting: TypeOrmWorkflowIdempotencyStore,
    },
    {
      provide: WORKFLOW_STATE_STORE,
      useExisting: TypeOrmWorkflowStateStore,
    },
    {
      provide: WORKFLOW_SIGNAL_STORE,
      useExisting: TypeOrmWorkflowSignalStore,
    },
    {
      provide: WORKFLOW_HISTORY_STORE,
      useExisting: TypeOrmWorkflowHistoryStore,
    },
    {
      provide: WORKFLOW_SNAPSHOT_STORE,
      useExisting: TypeOrmWorkflowSnapshotStore,
    },
    {
      provide: WORKFLOW_SCHEDULE_STORE,
      useExisting: TypeOrmWorkflowScheduleStore,
    },
  ],

  exports: [
    DatabaseWorkflowTransactionRunner,
    WorkflowPersistenceService,
    WORKFLOW_STATE_STORE,
    WORKFLOW_SIGNAL_STORE,
    WORKFLOW_HISTORY_STORE,
    WORKFLOW_IDEMPOTENCY_STORE,
    WORKFLOW_TRANSACTION_RUNNER,
    WORKFLOW_QUERY_STORE,
    WORKFLOW_SNAPSHOT_STORE,
    WORKFLOW_SCHEDULE_STORE,
  ],
})
export class WorkflowDatabasePersistenceModule {}
