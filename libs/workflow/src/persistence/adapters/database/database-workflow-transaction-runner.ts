import { Injectable } from '@nestjs/common';
import {
  runOnTransactionCommit,
  transactionContext,
  TransactionExecutor,
} from '@/database';

import { WorkflowTransactionRunner } from '../../../ports/workflow-transaction-runner';

@Injectable()
export class DatabaseWorkflowTransactionRunner implements WorkflowTransactionRunner {
  constructor(private readonly executor: TransactionExecutor) {}

  execute<T>(operation: () => Promise<T>): Promise<T> {
    return this.executor.execute(operation);
  }

  executeOrJoin<T>(operation: () => Promise<T>): Promise<T> {
    return this.executor.execute(operation);
  }

  isActive(): boolean {
    return transactionContext.active;
  }

  afterCommit(operation: () => Promise<void>): void {
    runOnTransactionCommit(operation);
  }
}
