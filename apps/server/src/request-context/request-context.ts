import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContextData {
  readonly requestId: string;
}

/**
 * Per-HTTP-request correlation id, mirroring the shape `libs/queue`'s
 * `RMQContext` already carries for messages (`requestId`/`correlationId`/
 * `causationId`) — this is the HTTP-side equivalent, so an error surfaced to
 * a client can be correlated with the exact server-side log lines for that
 * request without timestamp-matching. `AsyncLocalStorage`-backed, same
 * pattern `libs/database`'s `transactionContext`/`libs/workflow`'s various
 * contexts already use in this monorepo.
 */
export const requestContext = {
  storage: new AsyncLocalStorage<RequestContextData>(),

  run<T>(data: RequestContextData, fn: () => T): T {
    return this.storage.run(data, fn);
  },

  get current(): RequestContextData | undefined {
    return this.storage.getStore();
  },

  get requestId(): string | undefined {
    return this.storage.getStore()?.requestId;
  },
};
