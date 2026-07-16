import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { WorkflowEntityManagerProvider } from '../../workflow-entity-manager.provider';
import { TypeOrmWorkflowTransactionContext } from './stores/typeorm-workflow-transaction-context';

@Injectable()
export class TypeOrmWorkflowEntityManagerProvider implements WorkflowEntityManagerProvider {
  constructor(
    private readonly context: TypeOrmWorkflowTransactionContext,
    private readonly dataSource: DataSource,
  ) {}

  manager(): EntityManager {
    return this.context.get() ?? this.dataSource.manager;
  }
}
