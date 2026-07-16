import { WorkflowExecutionState } from '../models/workflow-execution-state';

export interface WorkflowLifecycleEvent {
  readonly type:
    'started' | 'completed' | 'failed' | 'cancelled' | 'expired' | 'signalled';

  readonly state: WorkflowExecutionState;
}

export interface WorkflowEventPublisher {
  publish(event: WorkflowLifecycleEvent): Promise<void>;
}
