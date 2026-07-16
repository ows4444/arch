import { EntityManager } from 'typeorm';

export interface WorkflowTransactionContext {
  run<T>(manager: EntityManager, operation: () => Promise<T>): Promise<T>;

  get(): EntityManager | undefined;
}
