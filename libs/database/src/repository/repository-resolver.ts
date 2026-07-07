import { Injectable } from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { DatabaseRole } from '../constants/database-role.enum';
import { DataSourceManager } from '../datasource/datasource.manager';
import { transactionContext } from '../transaction';
import { RepositoryClass } from '../interfaces/repository-class.interface';

@Injectable()
export class RepositoryResolver {
  constructor(private readonly dataSourceManager: DataSourceManager) {}

  resolve<TEntity extends ObjectLiteral>(
    entity: EntityTarget<TEntity>,
    role: DatabaseRole,
  ): Repository<TEntity> {
    if (role === DatabaseRole.WRITE && transactionContext.active) {
      return transactionContext.requireManager().getRepository(entity);
    }

    return this.dataSourceManager.repository(entity, role);
  }

  resolveFromManager<TEntity extends ObjectLiteral>(
    manager: EntityManager,
    entity: EntityTarget<TEntity>,
  ): Repository<TEntity> {
    return manager.getRepository(entity);
  }

  manager(role: DatabaseRole): EntityManager {
    if (role === DatabaseRole.WRITE && transactionContext.active) {
      return transactionContext.requireManager();
    }

    return this.dataSourceManager.manager(role);
  }

  dataSource(role: DatabaseRole): DataSource {
    return this.dataSourceManager.dataSource(role);
  }

  reportFailure(role: DatabaseRole, error: Error): void {
    this.dataSourceManager.reportFailure(role, error);
  }

  async waitForRecovery(
    role: DatabaseRole,
    maxWaitMs: number,
  ): Promise<boolean> {
    return this.dataSourceManager.waitForRecovery(role, maxWaitMs);
  }

  scoped<T>(
    repository: RepositoryClass<T>,
    role: DatabaseRole,
    manager: EntityManager,
  ): T {
    const instance = new repository(role, this);

    Object.defineProperty(instance, 'managerOverride', {
      value: manager,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    return instance;
  }
}
