import { WorkflowStepResult } from '../models/workflow-step-result';
import { WorkflowContext } from '../types/workflow-context';

export interface WorkflowStepHandler<TState extends object = object> {
  execute(
    context: WorkflowContext<TState>,
  ): Promise<WorkflowStepResult<TState>>;
}
