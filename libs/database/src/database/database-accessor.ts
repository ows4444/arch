import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryResolver } from '../repository/repository-resolver';

@Injectable()
export class DatabaseAccessor {
  constructor(
    private readonly role: DatabaseRole,
    private readonly resolver: RepositoryResolver,
  ) {}

  dataSource(): DataSource {
    return this.resolver.dataSource(this.role);
  }

  manager(): EntityManager {
    return this.resolver.manager(this.role);
  }
}
