import type { WorkflowTransactionRunner } from '../../ports/workflow-transaction-runner';

/**
 * Defers `operation` to `runner.afterCommit()` when a transaction is
 * currently active (e.g. a caller-supplied ambient transaction the write
 * this operation depends on had to join rather than commit on its own) —
 * same fire-and-forget semantics as `afterCommit` itself. When no
 * transaction is active, the write this operation depends on has already
 * committed independently by the time this is called, so `operation` runs
 * immediately (and is awaited, preserving call-site ordering) instead of
 * being queued for a commit that already happened.
 */
export async function afterCommitOrNow(
  runner: WorkflowTransactionRunner,
  operation: () => Promise<void>,
): Promise<void> {
  if (runner.isActive() && runner.afterCommit) {
    runner.afterCommit(operation);
    return;
  }

  await operation();
}
