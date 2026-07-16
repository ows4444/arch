import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AsyncLocalStorage } from 'node:async_hooks';
import { WorkflowTransactionContext } from '../../../../context/workflow-transaction-context';

@Injectable()
export class TypeOrmWorkflowTransactionContext implements WorkflowTransactionContext {
  private readonly storage = new AsyncLocalStorage<EntityManager>();

  run<T>(manager: EntityManager, operation: () => Promise<T>): Promise<T> {
    return this.storage.run(manager, operation);
  }

  get(): EntityManager | undefined {
    return this.storage.getStore();
  }
}
