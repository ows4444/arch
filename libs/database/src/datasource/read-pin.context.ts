import { AsyncLocalStorage } from 'node:async_hooks';
import type { DataSourceState } from '../interfaces/datasource-state';

/**
 * Pins a single automatic read-retry to the exact reader `DataSourceState`
 * selected for it, so that a mid-flight connectivity failure is reported
 * against (and recovery is awaited on) that same reader — never a reader
 * picked by a fresh, independent round-robin selection that may have moved
 * on in the meantime. Mirrors `transactionContext`'s ALS-based scoping.
 */
class ReadPinContext {
  private readonly storage = new AsyncLocalStorage<DataSourceState>();

  get current(): DataSourceState | undefined {
    return this.storage.getStore();
  }

  run<T>(state: DataSourceState, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(state, callback);
  }
}

export const readPinContext = new ReadPinContext();
