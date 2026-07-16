import { transactionContext } from '@/database';
import { DatabaseWorkflowTransactionRunner } from './database-workflow-transaction-runner';

describe('DatabaseWorkflowTransactionRunner', () => {
  it('delegates execute() to TransactionExecutor.execute() with no propagation option', async () => {
    const executor = { execute: jest.fn().mockResolvedValue('ok') };
    const runner = new DatabaseWorkflowTransactionRunner(executor as never);

    const operation = () => Promise.resolve('ok');

    await expect(runner.execute(operation)).resolves.toBe('ok');
    expect(executor.execute).toHaveBeenCalledWith(operation);
  });

  it('delegates executeOrJoin() to the same TransactionExecutor.execute() call', async () => {
    const executor = { execute: jest.fn().mockResolvedValue('ok') };
    const runner = new DatabaseWorkflowTransactionRunner(executor as never);

    const operation = () => Promise.resolve('ok');

    await expect(runner.executeOrJoin(operation)).resolves.toBe('ok');
    expect(executor.execute).toHaveBeenCalledWith(operation);
  });

  it('reflects the real ambient transactionContext.active state', async () => {
    const executor = { execute: jest.fn() };
    const runner = new DatabaseWorkflowTransactionRunner(executor as never);

    expect(runner.isActive()).toBe(false);

    await transactionContext.run({} as never, () => {
      expect(runner.isActive()).toBe(true);
      return Promise.resolve();
    });

    expect(runner.isActive()).toBe(false);
  });

  it('registers afterCommit callbacks via runOnTransactionCommit, only while a transaction is active', async () => {
    const executor = { execute: jest.fn() };
    const runner = new DatabaseWorkflowTransactionRunner(executor as never);
    const callback = jest.fn().mockResolvedValue(undefined);

    expect(() => runner.afterCommit(callback)).toThrow(/No active transaction/);

    await transactionContext.run({} as never, async () => {
      runner.afterCommit(callback);
      await transactionContext.commit();
    });

    expect(callback).toHaveBeenCalledTimes(1);
  });
});
