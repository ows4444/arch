import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';

interface TransactionStore {
  manager: EntityManager;
  depth: number;
  hooks: TransactionHooks;
  savepointCounter: { value: number };
}

export interface TransactionHooks {
  readonly commit: Set<() => void | Promise<void>>;
  readonly rollback: Set<(error: Error) => void | Promise<void>>;
  readonly complete: Set<(error?: Error) => void | Promise<void>>;
}

class TransactionContext {
  private readonly storage = new AsyncLocalStorage<TransactionStore>();

  get store(): TransactionStore | undefined {
    return this.storage.getStore();
  }

  snapshot(): TransactionStore | undefined {
    return this.storage.getStore();
  }

  runWithStore<T>(
    store: TransactionStore | undefined,
    callback: () => Promise<T>,
  ): Promise<T> {
    if (!store) {
      return callback();
    }

    return this.storage.run(store, callback);
  }

  get manager(): EntityManager | undefined {
    return this.storage.getStore()?.manager;
  }

  get depth(): number {
    return this.storage.getStore()?.depth ?? 0;
  }

  nextSavepointName(): string {
    const store = this.storage.getStore();

    if (!store) {
      throw new Error('No active transaction.');
    }

    store.savepointCounter.value += 1;

    return `sp_${store.savepointCounter.value}`;
  }

  get hooks(): TransactionHooks | undefined {
    return this.storage.getStore()?.hooks;
  }

  get active(): boolean {
    return this.manager !== undefined;
  }

  requireManager(): EntityManager {
    const manager = this.manager;

    if (!manager) {
      throw new Error('No active transaction.');
    }

    return manager;
  }

  async commit(): Promise<void> {
    const hooks = this.hooks;

    if (!hooks) {
      return;
    }

    try {
      for (const hook of hooks.commit) {
        await hook();
      }

      for (const hook of hooks.complete) {
        await hook();
      }
    } finally {
      this.clearHooks();
    }
  }

  async rollback(error: Error): Promise<void> {
    const hooks = this.hooks;

    if (!hooks) {
      return;
    }

    try {
      for (const hook of hooks.rollback) {
        await hook(error);
      }

      for (const hook of hooks.complete) {
        await hook(error);
      }
    } finally {
      this.clearHooks();
    }
  }

  private clearHooks(): void {
    const hooks = this.hooks;

    if (!hooks) {
      return;
    }

    hooks.commit.clear();
    hooks.rollback.clear();
    hooks.complete.clear();
  }

  run<T>(manager: EntityManager, callback: () => Promise<T>): Promise<T> {
    const parent = this.storage.getStore();

    return this.storage.run(
      {
        manager,
        depth: (parent?.depth ?? 0) + 1,
        hooks: parent?.hooks ?? {
          commit: new Set(),
          rollback: new Set(),
          complete: new Set(),
        },
        savepointCounter: parent?.savepointCounter ?? { value: 0 },
      },
      callback,
    );
  }

  runWithoutTransaction<T>(callback: () => Promise<T>): Promise<T> {
    return this.storage.exit(callback);
  }

  resume<T>(store: TransactionStore, callback: () => Promise<T>): Promise<T> {
    return this.storage.run(store, callback);
  }
}

export const transactionContext = new TransactionContext();
