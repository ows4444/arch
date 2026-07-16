import { DataSource } from 'typeorm';
import { TypeOrmWorkflowTransactionRunner } from './typeorm-workflow-transaction-runner';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';

describe('TypeOrmWorkflowTransactionRunner', () => {
  let dataSource: DataSource;
  let context: TypeOrmWorkflowTransactionContext;
  let runner: TypeOrmWorkflowTransactionRunner;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    context = new TypeOrmWorkflowTransactionContext();
    runner = new TypeOrmWorkflowTransactionRunner(dataSource, context);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('is not active outside of execute()', () => {
    expect(runner.isActive()).toBe(false);
  });

  it('is active while inside execute()', async () => {
    let observed = false;

    await runner.execute(() => {
      observed = runner.isActive();
      return Promise.resolve();
    });

    expect(observed).toBe(true);
    expect(runner.isActive()).toBe(false);
  });

  it('runs afterCommit callbacks only after the operation resolves', async () => {
    const order: string[] = [];

    await runner.execute(() => {
      runner.afterCommit?.(() => {
        order.push('afterCommit');
        return Promise.resolve();
      });
      order.push('operation');
      return Promise.resolve();
    });

    expect(order).toEqual(['operation', 'afterCommit']);
  });

  it('runs afterCommit callbacks in registration order', async () => {
    const order: number[] = [];

    await runner.execute(() => {
      runner.afterCommit?.(() => {
        order.push(1);
        return Promise.resolve();
      });
      runner.afterCommit?.(() => {
        order.push(2);
        return Promise.resolve();
      });
      return Promise.resolve();
    });

    expect(order).toEqual([1, 2]);
  });

  it('throws when afterCommit is called outside of an active transaction', () => {
    expect(() => runner.afterCommit?.(() => Promise.resolve())).toThrow(
      /must be called inside/,
    );
  });

  it('continues running remaining afterCommit callbacks when one throws', async () => {
    const ran: string[] = [];

    await runner.execute(() => {
      runner.afterCommit?.(() =>
        Promise.reject(new Error('first callback failed')),
      );
      runner.afterCommit?.(() => {
        ran.push('second');
        return Promise.resolve();
      });
      return Promise.resolve();
    });

    expect(ran).toEqual(['second']);
  });

  it('propagates the operation result through execute()', async () => {
    const result = await runner.execute(() => Promise.resolve('ok'));

    expect(result).toBe('ok');
  });

  it('propagates a thrown error from the operation and rolls back its writes', async () => {
    await expect(
      runner.execute(() => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
  });

  describe('executeOrJoin', () => {
    it('starts a new transaction when none is active', async () => {
      let observed = false;

      await runner.executeOrJoin(() => {
        observed = runner.isActive();
        return Promise.resolve();
      });

      expect(observed).toBe(true);
    });

    it('joins the ambient transaction rather than nesting a new one', async () => {
      let innerJoinedSameTransaction = false;

      await runner.execute(async () => {
        const manager = context.get();

        await runner.executeOrJoin(() => {
          innerJoinedSameTransaction = context.get() === manager;
          return Promise.resolve();
        });
      });

      expect(innerJoinedSameTransaction).toBe(true);
    });
  });
});
