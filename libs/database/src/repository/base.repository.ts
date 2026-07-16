import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DataSource,
  DeepPartial,
  DeleteResult,
  EntityManager,
  EntityTarget,
  FindManyOptions,
  FindOneOptions,
  FindOptionsWhere,
  InsertResult,
  ObjectLiteral,
  QueryRunner,
  Repository,
  SaveOptions,
  SelectQueryBuilder,
  UpdateResult,
  UpsertOptions,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { DatabaseRole } from '../constants/database-role.enum';
import { isDatabaseConnectivityError } from '../utils/database-error.util';
import { RepositoryResolver } from './repository-resolver';
import { OffsetPaginationResult } from '../pagination/pagination.types';
import { paginateOffset } from '../pagination/pagination.util';
import { transactionContext } from '../transaction/transaction.context';

export type DatabaseLockMode =
  | 'dirty_read'
  | 'for_key_share'
  | 'for_no_key_update'
  | 'pessimistic_partial_write'
  | 'pessimistic_read'
  | 'pessimistic_write'
  | 'pessimistic_write_or_fail';

export type DatabaseLockBehavior = 'nowait' | 'skip_locked';

@Injectable()
export abstract class BaseRepository<TEntity extends ObjectLiteral> {
  protected abstract readonly entity: EntityTarget<TEntity>;
  constructor(
    protected readonly role: DatabaseRole,
    protected readonly resolver: RepositoryResolver,
  ) {}

  protected readonly managerOverride?: EntityManager;

  protected get repository(): Repository<TEntity> {
    return this.getRepository();
  }

  protected getRepository(manager?: EntityManager): Repository<TEntity> {
    if (manager) {
      return manager.getRepository(this.entity);
    }

    if (this.managerOverride) {
      return this.managerOverride.getRepository(this.entity);
    }

    return this.resolver.resolve(this.entity, this.role);
  }

  protected get manager(): EntityManager {
    return this.resolver.manager(this.role);
  }

  protected get dataSource(): DataSource {
    return this.resolver.dataSource(this.role);
  }

  protected runRead<T>(
    operation: () => Promise<T>,
    explicitManager?: EntityManager,
  ): Promise<T> {
    return this.execute(operation, true, explicitManager);
  }

  protected runWrite<T>(
    operation: () => Promise<T>,
    explicitManager?: EntityManager,
  ): Promise<T> {
    return this.execute(operation, false, explicitManager);
  }

  private async execute<T>(
    operation: () => Promise<T>,
    retryOnFailure: boolean,
    explicitManager?: EntityManager,
  ): Promise<T> {
    // Only an automatic (no explicit manager), READ-role retry needs its
    // reader pinned: WRITE always targets a single writer deterministically,
    // and an explicit manager bypasses the resolver entirely. Pinning this
    // reader up front means the failure-handling below reports/waits on the
    // exact reader this attempt used, not one a fresh round-robin re-pick
    // might land on.
    const pinnedState =
      retryOnFailure && !explicitManager && this.role === DatabaseRole.READ
        ? this.resolver.peekReadState(this.role)
        : undefined;

    try {
      return await (pinnedState
        ? this.resolver.withPinnedState(pinnedState, operation)
        : operation());
    } catch (error) {
      if (!isDatabaseConnectivityError(error)) {
        throw error;
      }

      if (pinnedState) {
        this.resolver.reportFailure(this.role, error as Error, pinnedState);
      } else {
        this.resolver.reportFailure(this.role, error as Error);
      }

      if (!retryOnFailure) {
        throw new ServiceUnavailableException(
          'Database connectivity was lost during a write operation. The operation may or may not have been committed. Retry only if the operation is idempotent.',
        );
      }

      if (explicitManager) {
        throw new ServiceUnavailableException(
          'Database connectivity was lost while using an explicitly supplied EntityManager. ' +
            'That manager cannot be swapped for a recovered connection automatically — ' +
            'retry with a fresh manager (or without one) instead.',
        );
      }

      const recovered = pinnedState
        ? await this.resolver.waitForRecovery(this.role, undefined, pinnedState)
        : await this.resolver.waitForRecovery(this.role);

      if (recovered) {
        const retryState = this.resolver.peekReadState(this.role);

        return retryState
          ? this.resolver.withPinnedState(retryState, operation)
          : operation();
      }

      throw new ServiceUnavailableException(
        'Database is temporarily unavailable. Please retry.',
      );
    }
  }

  protected createQueryBuilder(alias: string): SelectQueryBuilder<TEntity> {
    return this.repository.createQueryBuilder(alias);
  }

  protected async paginateOffset(
    queryBuilder: SelectQueryBuilder<TEntity>,
    page = 1,
    limit = 20,
  ): Promise<OffsetPaginationResult<TEntity>> {
    return this.runRead(() => paginateOffset(queryBuilder, page, limit));
  }

  protected createLockedQueryBuilder(
    alias: string,
    lock: DatabaseLockMode,
  ): SelectQueryBuilder<TEntity> {
    return this.createQueryBuilder(alias).setLock(lock);
  }

  protected createOptimisticQueryBuilder(
    alias: string,
    version: number | Date,
  ): SelectQueryBuilder<TEntity> {
    return this.createQueryBuilder(alias).setLock('optimistic', version);
  }

  protected createQueryRunner(): QueryRunner {
    return this.dataSource.createQueryRunner();
  }

  protected query<T = unknown>(sql: string, parameters?: any[]): Promise<T> {
    if (this.role === DatabaseRole.WRITE) {
      return this.runWrite(() => this.manager.query(sql, parameters));
    }

    return this.runRead(() => this.manager.query(sql, parameters));
  }

  save(entity: DeepPartial<TEntity>, manager?: EntityManager) {
    return this.runWrite(() => this.getRepository(manager).save(entity));
  }

  saveMany(entities: DeepPartial<TEntity>[], manager?: EntityManager) {
    return this.runWrite(() => this.getRepository(manager).save(entities));
  }

  find(options?: FindManyOptions<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).find(options),
      manager,
    );
  }

  findOne(options: FindOneOptions<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).findOne(options),
      manager,
    );
  }

  findOneBy(where: FindOptionsWhere<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).findOneBy(where),
      manager,
    );
  }

  findBy(where: FindOptionsWhere<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).findBy(where),
      manager,
    );
  }

  existsBy(where: FindOptionsWhere<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).existsBy(where),
      manager,
    );
  }

  count(options?: FindManyOptions<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).count(options),
      manager,
    );
  }

  delete(
    where: FindOptionsWhere<TEntity>,
    manager?: EntityManager,
  ): Promise<DeleteResult> {
    return this.runWrite(() => this.getRepository(manager).delete(where));
  }

  update(
    where: FindOptionsWhere<TEntity>,
    entity: QueryDeepPartialEntity<TEntity>,
    manager?: EntityManager,
  ): Promise<UpdateResult> {
    return this.runWrite(() =>
      this.getRepository(manager).update(where, entity),
    );
  }

  remove(entity: TEntity, manager?: EntityManager) {
    return this.runWrite(() => this.getRepository(manager).remove(entity));
  }

  softDelete(where: FindOptionsWhere<TEntity>, manager?: EntityManager) {
    return this.runWrite(() => this.getRepository(manager).softDelete(where));
  }

  restore(where: FindOptionsWhere<TEntity>, manager?: EntityManager) {
    return this.runWrite(() => this.getRepository(manager).restore(where));
  }

  insert(
    entity: QueryDeepPartialEntity<TEntity> | QueryDeepPartialEntity<TEntity>[],
    manager?: EntityManager,
  ): Promise<InsertResult> {
    return this.runWrite(() => this.getRepository(manager).insert(entity));
  }

  upsert(
    entity: QueryDeepPartialEntity<TEntity> | QueryDeepPartialEntity<TEntity>[],
    conflictPaths: string[] | UpsertOptions<TEntity>,
    manager?: EntityManager,
  ): Promise<InsertResult> {
    return this.runWrite(() =>
      this.getRepository(manager).upsert(entity, conflictPaths),
    );
  }

  increment(
    where: FindOptionsWhere<TEntity>,
    property: keyof TEntity & string,
    value: number,
    manager?: EntityManager,
  ) {
    return this.runWrite(() =>
      this.getRepository(manager).increment(where, property, value),
    );
  }

  decrement(
    where: FindOptionsWhere<TEntity>,
    property: keyof TEntity & string,
    value: number,
    manager?: EntityManager,
  ) {
    return this.runWrite(() =>
      this.getRepository(manager).decrement(where, property, value),
    );
  }

  create(entity?: DeepPartial<TEntity>, manager?: EntityManager): TEntity {
    return entity
      ? this.getRepository(manager).create(entity)
      : this.getRepository(manager).create();
  }

  createMany(
    entities: DeepPartial<TEntity>[],
    manager?: EntityManager,
  ): TEntity[] {
    return this.getRepository(manager).create(entities);
  }

  merge(
    target: TEntity,
    manager?: EntityManager,
    ...sources: DeepPartial<TEntity>[]
  ): TEntity {
    return this.getRepository(manager).merge(target, ...sources);
  }

  preload(
    entity: DeepPartial<TEntity>,
    manager?: EntityManager,
  ): Promise<TEntity | undefined> {
    return this.runRead(
      () => this.getRepository(manager).preload(entity),
      manager,
    );
  }

  hasId(entity: TEntity, manager?: EntityManager): boolean {
    return this.getRepository(manager).hasId(entity);
  }

  getId(entity: TEntity, manager?: EntityManager): unknown {
    return this.getRepository(manager).getId(entity);
  }

  private assertActiveWriteTransaction(caller: string): void {
    if (this.role !== DatabaseRole.WRITE || !transactionContext.active) {
      throw new Error(
        `${caller}() requires an active transaction (call it on a WRITE-role repository inside @Transactional()); ` +
          'otherwise the pessimistic lock is acquired and released before this method returns, providing no protection.',
      );
    }
  }

  protected async findOneForUpdate(
    alias: string,
    where: FindOptionsWhere<TEntity>,
  ): Promise<TEntity | null> {
    this.assertActiveWriteTransaction('findOneForUpdate');

    return this.runRead(() =>
      this.createLockedQueryBuilder(alias, 'pessimistic_write')
        .where(where)
        .getOne(),
    );
  }

  protected async findOneForShare(
    alias: string,
    where: FindOptionsWhere<TEntity>,
  ): Promise<TEntity | null> {
    this.assertActiveWriteTransaction('findOneForShare');

    return this.runRead(() =>
      this.createLockedQueryBuilder(alias, 'pessimistic_read')
        .where(where)
        .getOne(),
    );
  }

  protected findOneOptimistic(
    alias: string,
    where: FindOptionsWhere<TEntity>,
    version: number | Date,
  ): Promise<TEntity | null> {
    return this.runRead(() =>
      this.createOptimisticQueryBuilder(alias, version).where(where).getOne(),
    );
  }

  findOneOrFail(options: FindOneOptions<TEntity>, manager?: EntityManager) {
    return this.runRead(
      () => this.getRepository(manager).findOneOrFail(options),
      manager,
    );
  }

  findAndCount(
    options?: FindManyOptions<TEntity>,
    manager?: EntityManager,
  ): Promise<[TEntity[], number]> {
    return this.runRead(
      () => this.getRepository(manager).findAndCount(options),
      manager,
    );
  }

  exists(
    options?: FindManyOptions<TEntity>,
    manager?: EntityManager,
  ): Promise<boolean> {
    return this.runRead(
      () => this.getRepository(manager).exists(options),
      manager,
    );
  }

  insertMany(
    entities: QueryDeepPartialEntity<TEntity>[],
    manager?: EntityManager,
  ) {
    return this.runWrite(() => this.getRepository(manager).insert(entities));
  }

  softRemove<T extends DeepPartial<TEntity>>(
    entity: T,
    options?: SaveOptions,
    manager?: EntityManager,
  ) {
    return this.runWrite(() =>
      this.getRepository(manager).softRemove(entity as TEntity, options),
    );
  }

  async softDeleteBy(where: FindOptionsWhere<TEntity>): Promise<void> {
    if (!this.repository.metadata.deleteDateColumn) {
      throw new Error(
        `Entity "${this.repository.metadata.tableName}" does not support soft deletes. Missing @DeleteDateColumn.`,
      );
    }

    await this.softDelete(where);
  }

  get tableName(): string {
    return this.repository.metadata.tableName;
  }
}
