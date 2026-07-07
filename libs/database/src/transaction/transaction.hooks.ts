import { transactionContext } from './transaction.context';

function requireHooks() {
  const hooks = transactionContext.hooks;

  if (!hooks) {
    throw new Error(
      'No active transaction found. Transaction hooks can only be registered inside a transaction.',
    );
  }

  return hooks;
}

export function runOnTransactionCommit(
  callback: () => void | Promise<void>,
): void {
  requireHooks().commit.add(callback);
}

export function runOnTransactionRollback(
  callback: (error: Error) => void | Promise<void>,
): void {
  requireHooks().rollback.add(callback);
}

export function runOnTransactionComplete(
  callback: (error?: Error) => void | Promise<void>,
): void {
  requireHooks().complete.add(callback);
}
