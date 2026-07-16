import { WorkflowContext } from '../types/workflow-context';

export interface WorkflowCompensationHandler<TState extends object = object> {
  compensate(context: WorkflowContext<TState>): Promise<void>;
}
