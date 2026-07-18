import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

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
import { TypeOrmWorkflowEntityManagerProvider } from './adapters/typeorm/typeorm-workflow-entity-manager.provider';
import { WorkflowIdempotencyEntity } from './adapters/typeorm/entities/workflow-idempotency.entity';
import { WorkflowScheduleEntity } from './adapters/typeorm/entities/workflow-schedule.entity';
import { WorkflowSignalEntity } from './adapters/typeorm/entities/workflow-signal.entity';
import { WorkflowStateEntity } from './adapters/typeorm/entities/workflow-state.entity';
import { WorkflowStepHistoryEntity } from './adapters/typeorm/entities/workflow-step-history.entity';
import { TypeOrmWorkflowHistoryStore } from './adapters/typeorm/stores/typeorm-workflow-history.store';
import { TypeOrmWorkflowIdempotencyStore } from './adapters/typeorm/stores/typeorm-workflow-idempotency.store';
import { TypeOrmWorkflowScheduleStore } from './adapters/typeorm/stores/typeorm-workflow-schedule.store';
import { TypeOrmWorkflowSignalStore } from './adapters/typeorm/stores/typeorm-workflow-signal.store';
import { TypeOrmWorkflowStateStore } from './adapters/typeorm/stores/typeorm-workflow-state.store';
import { TypeOrmWorkflowTransactionContext } from './adapters/typeorm/stores/typeorm-workflow-transaction-context';
import { TypeOrmWorkflowTransactionRunner } from './adapters/typeorm/stores/typeorm-workflow-transaction-runner';
import { WorkflowSnapshotEntity } from './adapters/typeorm/entities';
import { NoopWorkflowSnapshotStore } from './noop-snapshot.store';
import { TypeOrmWorkflowSnapshotStore } from './adapters/typeorm/stores/typeorm-workflow-snapshot.store';
import { WorkflowPersistenceService } from './workflow-persistence.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      WorkflowStateEntity,
      WorkflowSignalEntity,
      WorkflowStepHistoryEntity,
      WorkflowIdempotencyEntity,
      WorkflowSnapshotEntity,
      WorkflowScheduleEntity,
    ]),
  ],

  providers: [
    TypeOrmWorkflowTransactionContext,
    TypeOrmWorkflowTransactionRunner,
    TypeOrmWorkflowEntityManagerProvider,

    {
      provide: WORKFLOW_ENTITY_MANAGER_PROVIDER,
      useExisting: TypeOrmWorkflowEntityManagerProvider,
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
      provide: WORKFLOW_TRANSACTION_RUNNER,
      useExisting: TypeOrmWorkflowTransactionRunner,
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
    TypeOrmWorkflowTransactionContext,
    TypeOrmWorkflowTransactionRunner,
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
export class WorkflowPersistenceModule {}
