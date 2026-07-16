import { WorkflowSignal } from '../models/workflow-signal';
import { WorkflowRuntime } from './workflow-runtime';

export interface WorkflowContext<TState extends object = object> {
  readonly workflowId: string;
  readonly correlationId: string;
  readonly stepExecutionKey: string;
  readonly executionId: string;
  readonly workflowName: string;
  readonly currentStep?: string | undefined;
  readonly data: Readonly<TState>;
  readonly signal?: WorkflowSignal | undefined;
  readonly runtime: WorkflowRuntime;
}
