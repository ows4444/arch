/**
 * Durable marker for a side-effect deferred to `WorkflowTransactionRunner.afterCommit`
 * (spawning/cancelling children, scheduling a retry, etc.) that must run a *second*
 * transaction and so can't execute inside the state change's own still-open one.
 *
 * Persisted in the same transaction as the state change it originates from, and
 * cleared once the deferred callback actually runs. If the process crashes between
 * commit and the callback running, the marker survives on the row — `WorkflowAutoRecoveryService`'s
 * sweep finds it and re-invokes the effect, so the side-effect isn't silently dropped.
 *
 * `spawn-fan-out`'s specs are the workflow *name* (not the `Type<unknown>` class
 * reference `WorkflowChildSpawnSpec` normally carries) — a class reference isn't
 * JSON-serializable, and `WorkflowExecutor.execute` already accepts a plain name.
 */
export type WorkflowPendingEffect =
  | { readonly type: 'start-children' }
  | {
      readonly type: 'spawn-fan-out';
      readonly specs: readonly {
        readonly workflowName: string;
        readonly input?: Record<string, unknown>;
      }[];
    }
  | { readonly type: 'cancel-children' }
  | { readonly type: 'retry-child' }
  | { readonly type: 'schedule-retry-or-compensation' };
