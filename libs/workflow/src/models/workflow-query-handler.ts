import { WorkflowExecutionState } from './workflow-execution-state';

export interface WorkflowQueryHandler<
  TState extends Record<string, unknown> = Record<string, unknown>,
  TArgs = unknown,
  TResult = unknown,
> {
  handle(
    state: WorkflowExecutionState<TState>,
    args?: TArgs,
  ): TResult | Promise<TResult>;
}
