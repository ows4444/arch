import { EntityManager, QueryRunner } from 'typeorm';
import { DataSourceManager } from '../datasource/datasource.manager';
import { transactionContext } from './transaction.context';
import { DatabaseRole } from '../constants/database-role.enum';
import { Injectable } from '@nestjs/common';
import { IsolationLevel } from './isolation-level';
import { TransactionPropagation } from './transaction.constants';

export interface TransactionOptions {
  isolationLevel?: IsolationLevel;
  manager?: EntityManager;
  propagation?: TransactionPropagation;
  queryRunner?: QueryRunner;
  timeoutMs?: number;
}

@Injectable()
export class TransactionExecutor {
  constructor(private readonly dataSourceManager: DataSourceManager) {}

  async execute<T>(
    callback: () => Promise<T>,
    options?: TransactionOptions,
  ): Promise<T> {
    if (
      options?.propagation === TransactionPropagation.NOT_SUPPORTED &&
      transactionContext.active
    ) {
      const suspended = transactionContext.snapshot();

      if (!suspended) {
        return callback();
      }

      let result: T;
      let threw = false;
      let caughtError: unknown;

      try {
        result = await transactionContext.runWithoutTransaction(callback);
      } catch (error) {
        threw = true;
        caughtError = error;
        result = undefined as unknown as T;
      }

      return transactionContext.resume(suspended, () => {
        if (threw) {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
          return Promise.reject(caughtError);
        }

        return Promise.resolve(result);
      });
    }

    if (
      options?.propagation === TransactionPropagation.REQUIRES_NEW &&
      !options.queryRunner
    ) {
      const dataSource = this.dataSourceManager.dataSource(DatabaseRole.WRITE);

      const runner = dataSource.createQueryRunner();

      await runner.connect();

      try {
        if (options.isolationLevel) {
          await runner.startTransaction(options.isolationLevel);
        } else {
          await runner.startTransaction();
        }

        const result = await transactionContext.runWithoutTransaction(() =>
          this.execute(callback, {
            ...options,
            manager: undefined,
            queryRunner: runner,
          }),
        );

        await runner.commitTransaction();

        await transactionContext.commit();

        return result;
      } catch (error) {
        try {
          await runner.rollbackTransaction();
        } catch {
          // Preserve the original application error.
        }

        if (error instanceof Error) {
          await transactionContext.rollback(error);
        }

        throw error;
      } finally {
        await runner.release();
      }
    }

    if (
      options?.propagation === TransactionPropagation.MANDATORY &&
      !transactionContext.active
    ) {
      throw new Error(
        'Transaction propagation MANDATORY requires an active transaction.',
      );
    }

    if (
      options?.propagation === TransactionPropagation.NEVER &&
      transactionContext.active
    ) {
      throw new Error(
        'Transaction propagation NEVER must not execute inside an active transaction.',
      );
    }

    if (
      options?.propagation === TransactionPropagation.SUPPORTS &&
      !transactionContext.active
    ) {
      return callback();
    }

    if (transactionContext.active) {
      if (options?.propagation !== TransactionPropagation.NESTED) {
        return callback();
      }

      const manager = transactionContext.requireManager();
      const runner = manager.queryRunner;

      if (!runner) {
        return callback();
      }

      const savepoint = transactionContext.nextSavepointName();

      await runner.query(`SAVEPOINT ${savepoint}`);

      try {
        const result = await transactionContext.run(manager, callback);

        await runner.query(`RELEASE SAVEPOINT ${savepoint}`);

        return result;
      } catch (error) {
        await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);

        throw error;
      }
    }

    const transaction = async (manager: EntityManager): Promise<T> => {
      const operation = async (): Promise<T> => {
        try {
          const result = await transactionContext.run(manager, callback);

          await transactionContext.commit();

          return result;
        } catch (error) {
          if (error instanceof Error) {
            await transactionContext.rollback(error);
          }

          throw error;
        }
      };

      if (!options?.timeoutMs) {
        return operation();
      }

      let timer: NodeJS.Timeout | undefined;

      try {
        return await Promise.race([
          operation(),
          new Promise<T>((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new Error(
                  `Transaction exceeded timeout (${options.timeoutMs} ms).`,
                ),
              );
            }, options.timeoutMs);
          }),
        ]);
      } catch (error) {
        if (error instanceof Error) {
          await transactionContext.rollback(error);
        }

        throw error;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    };

    if (options?.manager) {
      return transaction(options.manager);
    }

    if (options?.queryRunner) {
      return transaction(options.queryRunner.manager);
    }

    const dataSource = this.dataSourceManager.dataSource(DatabaseRole.WRITE);

    if (options?.isolationLevel) {
      return dataSource.transaction(options.isolationLevel, transaction);
    }

    return dataSource.transaction(transaction);
  }
}
