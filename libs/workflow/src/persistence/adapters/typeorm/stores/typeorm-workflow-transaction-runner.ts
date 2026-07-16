import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DataSource } from 'typeorm';
import { Logger } from '@nestjs/common';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { WorkflowTransactionRunner } from '../../../../ports/workflow-transaction-runner';

@Injectable()
export class TypeOrmWorkflowTransactionRunner implements WorkflowTransactionRunner {
  private readonly logger = new Logger(TypeOrmWorkflowTransactionRunner.name);

  private readonly storage = new AsyncLocalStorage<
    Array<() => Promise<void>>
  >();
  constructor(
    private readonly dataSource: DataSource,
    private readonly context: TypeOrmWorkflowTransactionContext,
  ) {}

  executeOrJoin<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isActive()) {
      return operation();
    }

    return this.execute(operation);
  }

  execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isActive()) {
      return operation();
    }

    return this.storage.run([], async () => {
      const result = await this.dataSource.transaction((manager) =>
        this.context.run(manager, operation),
      );

      const callbacks = [...(this.storage.getStore() ?? [])];

      const failures: unknown[] = [];

      for (const callback of callbacks) {
        try {
          await callback();
        } catch (error) {
          failures.push(error);

          this.logger.error(
            'Workflow afterCommit callback failed',
            error instanceof Error ? error.stack : String(error),
          );
        }
      }

      if (failures.length > 0) {
        this.logger.warn(`${failures.length} afterCommit callback(s) failed.`);
      }

      return result;
    });
  }

  afterCommit(operation: () => Promise<void>): void {
    const callbacks = this.storage.getStore();

    if (!callbacks) {
      throw new Error(
        'afterCommit() must be called inside WorkflowTransactionRunner.execute()',
      );
    }

    callbacks.push(operation);
  }

  isActive(): boolean {
    return this.context.get() !== undefined;
  }
}
