export interface WorkflowTransactionRunner {
  execute<T>(operation: () => Promise<T>): Promise<T>;

  executeOrJoin<T>(operation: () => Promise<T>): Promise<T>;

  isActive(): boolean;

  afterCommit?(operation: () => Promise<void>): void;
}
