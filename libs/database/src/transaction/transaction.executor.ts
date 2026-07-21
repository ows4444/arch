import { EntityManager, QueryRunner } from 'typeorm';
import { DataSourceManager } from '../datasource/datasource.manager';
import { transactionContext } from './transaction.context';
import { DatabaseRole } from '../constants/database-role.enum';
import { Injectable, Logger } from '@nestjs/common';
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
  private readonly logger = new Logger(TransactionExecutor.name);

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
      options?.propagation === TransactionPropagation.NOT_SUPPORTED &&
      !transactionContext.active
    ) {
      return callback();
    }

    if (
      options?.propagation === TransactionPropagation.REQUIRES_NEW &&
      !options.queryRunner
    ) {
      // Suspend any ambient transaction so the new transaction's manager and
      // commit/rollback hooks are fully independent of it, then delegate to
      // the same owned-transaction runner the default (fresh-REQUIRED) path
      // uses below — see `runOwnedTransaction` for why hook firing has to be
      // ordered after the physical COMMIT/ROLLBACK, not merely after the
      // callback settles.
      return transactionContext.runWithoutTransaction(() =>
        this.runOwnedTransaction(callback, {
          isolationLevel: options.isolationLevel,
          timeoutMs: options.timeoutMs,
        }),
      );
    }

    if (
      options?.propagation === TransactionPropagation.MANDATORY &&
      !transactionContext.active
    ) {
      throw new Error(
        'Transaction propagation MANDATORY requires an active transaction.',
      );
    }

    if (options?.propagation === TransactionPropagation.NEVER) {
      if (transactionContext.active) {
        throw new Error(
          'Transaction propagation NEVER must not execute inside an active transaction.',
        );
      }

      return callback();
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

    // A caller-supplied manager/queryRunner means the caller owns the actual
    // transaction boundary (they started it, and they're responsible for
    // committing/rolling it back elsewhere) — this method only runs the
    // callback inside it and fires hooks once the callback settles, since
    // there is no physical commit happening here to order against.
    if (options?.manager) {
      return this.runWithAmbientManager(callback, options.manager, options);
    }

    if (options?.queryRunner) {
      return this.runWithAmbientManager(
        callback,
        options.queryRunner.manager,
        options,
      );
    }

    // No caller-supplied manager and no ambient transaction: this call owns
    // the transaction outright, so hook firing can and must be ordered
    // against the physical COMMIT/ROLLBACK (see `runOwnedTransaction`).
    return this.runOwnedTransaction(callback, {
      isolationLevel: options?.isolationLevel,
      timeoutMs: options?.timeoutMs,
    });
  }

  /**
   * Runs `callback` inside a transaction this method creates and fully owns
   * (via a manually-driven `QueryRunner`, not `EntityManager.transaction()`)
   * — used for both a fresh `REQUIRED` transaction and `REQUIRES_NEW`.
   *
   * Hook ordering is the reason this doesn't just use
   * `dataSource.transaction()`: that helper calls the callback and only
   * physically commits *after* the callback's promise resolves, with no hook
   * exposed in between. Committing/rolling back manually — and only firing
   * `transactionContext.commit()`/`rollback()` after that physical
   * COMMIT/ROLLBACK settles, while still inside the transaction's
   * `AsyncLocalStorage` context — guarantees commit-hook side effects (e.g.
   * an outbox dispatch signal via `runOnTransactionCommit`) never run before
   * the data they depend on is actually durable, and never run at all if the
   * physical COMMIT itself fails.
   */
  private async runOwnedTransaction<T>(
    callback: () => Promise<T>,
    options: {
      isolationLevel?: IsolationLevel | undefined;
      timeoutMs?: number | undefined;
    },
  ): Promise<T> {
    const dataSource = this.dataSourceManager.dataSource(DatabaseRole.WRITE);
    const runner = dataSource.createQueryRunner();

    await runner.connect();

    try {
      if (options.isolationLevel) {
        await runner.startTransaction(options.isolationLevel);
      } else {
        await runner.startTransaction();
      }

      const operation = (): Promise<T> =>
        transactionContext.run(runner.manager, async () => {
          try {
            const result = await callback();

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
          }
        });

      return options.timeoutMs
        ? await this.runWithTimeout(operation, options.timeoutMs)
        : await operation();
    } finally {
      await runner.release();
    }
  }

  /** See the `options?.manager`/`options?.queryRunner` branches in `execute()`. */
  private runWithAmbientManager<T>(
    callback: () => Promise<T>,
    manager: EntityManager,
    options: Pick<TransactionOptions, 'timeoutMs'>,
  ): Promise<T> {
    const operation = (): Promise<T> =>
      transactionContext.run(manager, async () => {
        try {
          const result = await callback();

          await transactionContext.commit();

          return result;
        } catch (error) {
          if (error instanceof Error) {
            await transactionContext.rollback(error);
          }

          throw error;
        }
      });

    return options.timeoutMs
      ? this.runWithTimeout(operation, options.timeoutMs)
      : operation();
  }

  /**
   * Races `operation` against `timeoutMs`. On timeout, logs and waits for
   * the real operation to finish rather than abandoning it — the in-flight
   * query/transaction can't actually be cancelled, so racing ahead here
   * would let the caller move on while the transaction's commit/rollback
   * (and its hooks) are still pending in the background.
   */
  private async runWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
  ): Promise<T> {
    const operationPromise = operation();

    let timer: NodeJS.Timeout | undefined;
    let timedOut = false;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Transaction exceeded timeout (${timeoutMs} ms).`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([operationPromise, timeoutPromise]);
    } catch (error) {
      if (timedOut) {
        this.logger.warn(
          `Transaction exceeded timeout (${timeoutMs} ms); waiting for it to finish rather than aborting, since the in-flight query cannot be cancelled.`,
        );

        return await operationPromise;
      }

      throw error;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
