import { WorkflowJoinSummary } from '../models/workflow-join-summary';

export interface WorkflowRuntime {
  readonly abortSignal: AbortSignal;

  isCancelled(): Promise<boolean>;

  /**
   * Present only when this step is resuming from a fan-out join (i.e. it
   * was declared as the `nextStep` of a `spawnChildren` result) —
   * summarizes what happened to the fanned-out branches
   * (succeeded/failed/pending), so the join step can react to a partial
   * result without querying `ChildWorkflowService` itself.
   */
  joinResults?(): Promise<WorkflowJoinSummary>;
}
