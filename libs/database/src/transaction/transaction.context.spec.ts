import type { EntityManager } from 'typeorm';
import { transactionContext } from './transaction.context';

function fakeManager(label: string): EntityManager {
  return { label } as unknown as EntityManager;
}

describe('transactionContext', () => {
  it('active is false outside any run()', () => {
    expect(transactionContext.active).toBe(false);
    expect(transactionContext.manager).toBeUndefined();
  });

  it('active is true inside run()', async () => {
    await transactionContext.run(fakeManager('m1'), () => {
      expect(transactionContext.active).toBe(true);
      expect(transactionContext.manager).toBeDefined();
      return Promise.resolve();
    });
  });

  it('nextSavepointName() throws when there is no active transaction', () => {
    expect(() => transactionContext.nextSavepointName()).toThrow(
      'No active transaction.',
    );
  });

  it('produces sequential savepoint names inside run()', async () => {
    await transactionContext.run(fakeManager('m1'), () => {
      expect(transactionContext.nextSavepointName()).toBe('sp_1');
      expect(transactionContext.nextSavepointName()).toBe('sp_2');
      expect(transactionContext.nextSavepointName()).toBe('sp_3');
      return Promise.resolve();
    });
  });

  it('nested run() calls share hooks and savepointCounter but increment depth', async () => {
    await transactionContext.run(fakeManager('outer'), async () => {
      expect(transactionContext.depth).toBe(1);
      const outerHooks = transactionContext.hooks;
      expect(transactionContext.nextSavepointName()).toBe('sp_1');

      await transactionContext.run(fakeManager('inner'), () => {
        expect(transactionContext.depth).toBe(2);
        expect(transactionContext.hooks).toBe(outerHooks);
        // savepoint counter is shared across nesting, so numbering continues
        expect(transactionContext.nextSavepointName()).toBe('sp_2');
        return Promise.resolve();
      });

      expect(transactionContext.depth).toBe(1);
    });
  });

  it('runWithoutTransaction() makes active false inside its callback even nested inside an active run()', async () => {
    await transactionContext.run(fakeManager('outer'), async () => {
      expect(transactionContext.active).toBe(true);

      await transactionContext.runWithoutTransaction(() => {
        expect(transactionContext.active).toBe(false);
        expect(transactionContext.manager).toBeUndefined();
        return Promise.resolve();
      });

      expect(transactionContext.active).toBe(true);
    });
  });

  it('resume() restores a previously captured store via snapshot()', async () => {
    let capturedStore: ReturnType<typeof transactionContext.snapshot>;

    await transactionContext.run(fakeManager('captured'), () => {
      capturedStore = transactionContext.snapshot();
      return Promise.resolve();
    });

    // outside any run(), there is no active transaction
    expect(transactionContext.active).toBe(false);

    await transactionContext.resume(capturedStore!, () => {
      expect(transactionContext.active).toBe(true);
      expect(transactionContext.manager).toBeDefined();
      return Promise.resolve();
    });

    expect(transactionContext.active).toBe(false);
  });
});
