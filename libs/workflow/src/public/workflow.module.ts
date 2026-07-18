import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import {
  WORKFLOW_ARCHIVE_STORE,
  WORKFLOW_EVENT_PUBLISHER,
  WORKFLOW_METRICS,
  WORKFLOW_PARENT_FAILURE_HANDLER,
  WORKFLOW_RETRY_JITTER,
  WORKFLOW_RETRY_SCHEDULER,
} from '../constants/workflow.tokens';
import { WorkflowCompensationService } from '../engine/compensation/service';
import { WorkflowExecutor } from '../engine/executor/executor';
import { WorkflowRunner } from '../engine/executor/runner';
import { WorkflowStepExecutor } from '../engine/executor/step-executor';
import { WorkflowStepPersistenceService } from '../engine/executor/step-persistence';
import { WorkflowStepResolver } from '../engine/executor/step-resolver';
import { WorkflowHookExecutor } from '../engine/hooks/hook-executor';
import { WorkflowCompletionService } from '../engine/lifecycle/completion.service';
import { WorkflowFailureService } from '../engine/lifecycle/failure.service';
import { WorkflowLifecyclePublisher } from '../engine/lifecycle/lifecycle.publisher';
import { WorkflowLifecycleService } from '../engine/lifecycle/lifecycle.service';
import { WorkflowDiscovery } from '../engine/registry/discovery';
import { WorkflowRegistry } from '../engine/registry/registry';
import { WorkflowAutoRecoveryService } from '../engine/retry/auto-recovery.service';
import { DefaultWorkflowRetryJitterService } from '../engine/retry/default-jitter.service';
import { DefaultWorkflowRetryScheduler } from '../engine/retry/default-scheduler.service';
import { WorkflowRetryDelayService } from '../engine/retry/delay.service';
import { WorkflowRecoveryService } from '../engine/retry/recovery.service';
import { WorkflowRetryService } from '../engine/retry/retry.service';
import { WorkflowSignalProcessor } from '../engine/signals/signal.processor';
import { WorkflowSignalService } from '../engine/signals/signal.service';
import { WorkflowStateFactory } from '../engine/state/factory';
import { WorkflowStateService } from '../engine/state/service';
import { WorkflowTransitionValidator } from '../engine/state/transition-validator';
import { WorkflowStateTransitions } from '../engine/state/transitions';
import { WorkflowStateValidator } from '../engine/state/validator';
import { WorkflowDefinitionValidator } from '../engine/validation/definition.validator';
import { WorkflowStepResultValidator } from '../engine/validation/step-result.validator';
import { WorkflowLeaseService } from '../infrastructure/lease/lease.service';
import { WorkflowLogger } from '../observability/logger';
import { NoopWorkflowMetricsService } from '../observability/noop-metrics.service';
import { WorkflowHistoryService } from '../persistence/history.service';
import { WorkflowRetentionService } from '../retention/retention.service';
import { WorkflowClient } from './api/workflow-client';
import { WorkflowQueryService } from './api/workflow-query.service';
import { NoopWorkflowArchiveStore } from '../retention/noop-archive.store';
import { ChildWorkflowService } from '../engine/child-workflow/child-workflow.service';
import { ScheduleModule } from '@nestjs/schedule';
import { NoopWorkflowEventPublisher } from '../observability/noop-event.publisher';
import { WorkflowPersistenceModule } from '../persistence/workflow-persistence.module';
import { WorkflowDatabasePersistenceModule } from '../persistence/workflow-database-persistence.module';

const BASE_PROVIDERS: Provider[] = [
  WorkflowStateTransitions,
  WorkflowQueryService,
  WorkflowStateValidator,
  WorkflowStateFactory,
  WorkflowStateService,
  ChildWorkflowService,

  WorkflowCompletionService,
  WorkflowHookExecutor,
  WorkflowLifecyclePublisher,
  WorkflowLifecycleService,
  WorkflowRunner,
  WorkflowCompensationService,
  WorkflowTransitionValidator,
  WorkflowStepResultValidator,
  DefaultWorkflowRetryJitterService,
  DefaultWorkflowRetryScheduler,
  NoopWorkflowArchiveStore,

  {
    provide: WORKFLOW_ARCHIVE_STORE,
    useExisting: NoopWorkflowArchiveStore,
  },

  {
    provide: WORKFLOW_RETRY_JITTER,
    useExisting: DefaultWorkflowRetryJitterService,
  },

  {
    provide: WORKFLOW_RETRY_SCHEDULER,
    useExisting: DefaultWorkflowRetryScheduler,
  },

  {
    provide: WORKFLOW_PARENT_FAILURE_HANDLER,
    useExisting: WorkflowFailureService,
  },

  WorkflowClient,
  WorkflowRegistry,
  WorkflowDiscovery,
  WorkflowDefinitionValidator,
  WorkflowStepResolver,
  WorkflowExecutor,
  WorkflowStepExecutor,
  WorkflowRecoveryService,
  WorkflowHistoryService,
  WorkflowStepPersistenceService,
  WorkflowSignalService,
  WorkflowSignalProcessor,
  WorkflowAutoRecoveryService,
  WorkflowFailureService,
  WorkflowRetryService,
  WorkflowRetryDelayService,
  WorkflowLeaseService,
  WorkflowLogger,
  WorkflowRetentionService,
];

const DEFAULT_METRICS_PROVIDERS: Provider[] = [
  NoopWorkflowMetricsService,
  { provide: WORKFLOW_METRICS, useExisting: NoopWorkflowMetricsService },
];

const DEFAULT_EVENT_PUBLISHER_PROVIDERS: Provider[] = [
  NoopWorkflowEventPublisher,
  {
    provide: WORKFLOW_EVENT_PUBLISHER,
    useExisting: NoopWorkflowEventPublisher,
  },
];

export type WorkflowPersistenceBackend = 'typeorm' | 'database';

function persistenceModuleFor(
  backend: WorkflowPersistenceBackend,
): typeof WorkflowPersistenceModule | typeof WorkflowDatabasePersistenceModule {
  return backend === 'database'
    ? WorkflowDatabasePersistenceModule
    : WorkflowPersistenceModule;
}

function moduleImportsFor(backend: WorkflowPersistenceBackend) {
  return [
    DiscoveryModule,
    ScheduleModule.forRoot(),
    persistenceModuleFor(backend),
  ];
}

function moduleExportsFor(backend: WorkflowPersistenceBackend) {
  return [
    persistenceModuleFor(backend),
    WorkflowClient,
    WorkflowQueryService,
    WorkflowRegistry,
    WorkflowStepResolver,
    WorkflowExecutor,
    WorkflowSignalService,
    WORKFLOW_ARCHIVE_STORE,
    WORKFLOW_RETRY_JITTER,
    WORKFLOW_RETRY_SCHEDULER,
    WORKFLOW_EVENT_PUBLISHER,
    WORKFLOW_PARENT_FAILURE_HANDLER,
    WORKFLOW_METRICS,
    WorkflowRecoveryService,
  ];
}

export interface WorkflowModuleOptions {
  readonly metrics?: Provider;
  readonly eventPublisher?: Provider;
  readonly persistence?: WorkflowPersistenceBackend;
}

@Module({})
export class WorkflowModule {
  static forRoot(options: WorkflowModuleOptions = {}): DynamicModule {
    const backend = options.persistence ?? 'typeorm';

    return {
      module: WorkflowModule,
      imports: moduleImportsFor(backend),
      providers: [
        ...BASE_PROVIDERS,
        ...(options.metrics ? [options.metrics] : DEFAULT_METRICS_PROVIDERS),
        ...(options.eventPublisher
          ? [options.eventPublisher]
          : DEFAULT_EVENT_PUBLISHER_PROVIDERS),
      ],
      exports: moduleExportsFor(backend),
    };
  }
}
