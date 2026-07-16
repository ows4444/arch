import { WorkflowSignal } from './workflow-signal';
import { WorkflowStepId } from './workflow-step-id';

export interface WorkflowStepResult<TState extends object = object> {
  readonly nextStep?: WorkflowStepId;

  readonly waitForSignal?: WorkflowSignal;

  readonly data?: Partial<TState>;
}
