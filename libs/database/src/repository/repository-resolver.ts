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
import { readPinContext } from '../datasource/read-pin.context';
import { transactionContext } from '../transaction';
import { RepositoryClass } from '../interfaces/repository-class.interface';
import type { DataSourceState } from '../interfaces/datasource-state';

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

    if (role === DatabaseRole.READ && readPinContext.current) {
      return this.dataSourceManager.repositoryForState(
        entity,
        readPinContext.current,
      );
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

    if (role === DatabaseRole.READ && readPinContext.current) {
      return this.dataSourceManager.managerForState(readPinContext.current);
    }

    return this.dataSourceManager.manager(role);
  }

  dataSource(role: DatabaseRole): DataSource {
    return this.dataSourceManager.dataSource(role);
  }

  /**
   * Selects the reader a subsequent automatic read-retry will use, so the
   * caller can pin the operation to it (`withPinnedState`) and later report
   * failure/await recovery against that exact same reader rather than one
   * re-selected independently by round-robin. See `readPinContext`.
   */
  peekReadState(role: DatabaseRole): DataSourceState | undefined {
    return this.dataSourceManager.peekReadState(role);
  }

  withPinnedState<T>(state: DataSourceState, fn: () => Promise<T>): Promise<T> {
    return readPinContext.run(state, fn);
  }

  reportFailure(
    role: DatabaseRole,
    error: Error,
    state?: DataSourceState,
  ): void {
    if (state) {
      this.dataSourceManager.reportFailureForState(state, error);
      return;
    }

    this.dataSourceManager.reportFailure(role, error);
  }

  async waitForRecovery(
    role: DatabaseRole,
    maxWaitMs?: number,
    state?: DataSourceState,
  ): Promise<boolean> {
    if (state) {
      return this.dataSourceManager.waitForRecoveryForState(state, maxWaitMs);
    }

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
