import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { DatabaseRole, RepositoryResolver } from '@/database';

import { WorkflowEntityManagerProvider } from '../../workflow-entity-manager.provider';

@Injectable()
export class DatabaseWorkflowEntityManagerProvider implements WorkflowEntityManagerProvider {
  constructor(private readonly resolver: RepositoryResolver) {}

  manager(): EntityManager {
    return this.resolver.manager(DatabaseRole.WRITE);
  }
}
