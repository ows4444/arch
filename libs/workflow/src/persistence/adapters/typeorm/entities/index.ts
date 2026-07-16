import { WorkflowIdempotencyEntity } from './workflow-idempotency.entity';
import { WorkflowSignalEntity } from './workflow-signal.entity';
import { WorkflowSnapshotEntity } from './workflow-snapshot.entity';
import { WorkflowStateEntity } from './workflow-state.entity';
import { WorkflowStepHistoryEntity } from './workflow-step-history.entity';

export const WORKFLOW_TYPEORM_ENTITIES = [
  WorkflowStateEntity,
  WorkflowSignalEntity,
  WorkflowStepHistoryEntity,
  WorkflowIdempotencyEntity,
  WorkflowSnapshotEntity,
] as const;

export { WorkflowStateEntity } from './workflow-state.entity';
export { WorkflowSignalEntity } from './workflow-signal.entity';
export { WorkflowStepHistoryEntity } from './workflow-step-history.entity';
export { WorkflowIdempotencyEntity } from './workflow-idempotency.entity';
export { WorkflowSnapshotEntity } from './workflow-snapshot.entity';
