import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

import { DatabaseRole } from '../constants/database-role.enum';
import { DataSourceManager } from '../datasource/datasource.manager';

@Injectable()
export class DatabaseAccessor {
  constructor(
    private readonly role: DatabaseRole,
    private readonly DSManager: DataSourceManager,
  ) {}

  dataSource(): DataSource {
    return this.DSManager.dataSource(this.role);
  }

  manager(): EntityManager {
    return this.DSManager.manager(this.role);
  }
}
