/*
 * Public module
 */
export * from './public/workflow.module';

/*
 * Client API
 */
export * from './public/api/workflow-client';
export * from './public/api/workflow-query.service';
export * from './query/workflow-query.service';
export type { WorkflowExecutionOptions } from './engine/executor/executor';

/*
 * Ports
 */
export * from './ports/workflow-parent-failure-handler';
export * from './ports/workflow-event-publisher';

/*
 * Persistence
 */
export {
  WORKFLOW_TYPEORM_ENTITIES,
  WorkflowStateEntity,
  WorkflowSignalEntity,
  WorkflowStepHistoryEntity,
  WorkflowIdempotencyEntity,
  WorkflowSnapshotEntity,
} from './persistence/adapters/typeorm/entities/index';

export {
  WORKFLOW_MIGRATIONS,
  InitialWorkflowSchema1752000000000,
} from './persistence/adapters/typeorm/migrations/index';

/*
 * Decorators
 */
export * from './workflow/workflow.decorator';
export * from './steps/step.decorator';
export * from './engine/hooks/hook.decorator';
export * from './engine/signals/signal.decorator';

/*
 * Constants
 */
export * from './constants/workflow.constants';
export * from './constants/workflow.tokens';

/*
 * Handler contracts
 */
export * from './handlers/workflow-step-handler';
export * from './handlers/workflow-compensation-handler';

/*
 * Models
 */
export * from './models/workflow-execution-result';
export * from './models/workflow-execution-state';
export * from './models/workflow-step-result';
export * from './models/workflow-signal';
export * from './models/workflow-step-id';
export * from './models/workflow-failure';
export * from './models/workflow-metrics';

/*
 * Types
 */
export * from './types/workflow-context';
export * from './types/workflow-runtime';
export * from './types/workflow-details';
export * from './types/workflow-status';

/*
 * Metadata
 */
export * from './definition/workflow-metadata';
export * from './definition/workflow-step-metadata';

/*
 * Errors
 */
export * from './errors';
export * from './errors/workflow.errors';
