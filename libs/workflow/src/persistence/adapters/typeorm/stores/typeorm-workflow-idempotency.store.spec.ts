import { DataSource } from 'typeorm';
import { TypeOrmWorkflowIdempotencyStore } from './typeorm-workflow-idempotency.store';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { TypeOrmWorkflowEntityManagerProvider } from '../typeorm-workflow-entity-manager.provider';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';

describe('TypeOrmWorkflowIdempotencyStore', () => {
  let dataSource: DataSource;
  let store: TypeOrmWorkflowIdempotencyStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    store = new TypeOrmWorkflowIdempotencyStore(
      new TypeOrmWorkflowEntityManagerProvider(
        new TypeOrmWorkflowTransactionContext(),
        dataSource,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('acquires a previously unseen key', async () => {
    await expect(store.acquire('key-1', 'wf-1')).resolves.toBe(true);
  });

  it('refuses to acquire a key that is already held', async () => {
    await store.acquire('key-1', 'wf-1');

    await expect(store.acquire('key-1', 'wf-1')).resolves.toBe(false);
  });

  it('reports existence of an acquired key', async () => {
    await store.acquire('key-1', 'wf-1');

    await expect(store.exists('key-1')).resolves.toBe(true);
    await expect(store.exists('key-missing')).resolves.toBe(false);
  });

  it('allows re-acquiring a key after it is released', async () => {
    await store.acquire('key-1', 'wf-1');
    await store.release('key-1');

    await expect(store.acquire('key-1', 'wf-1')).resolves.toBe(true);
  });

  it('does not release a key that has already been marked completed', async () => {
    await store.acquire('key-1', 'wf-1');
    await store.markCompleted('key-1', 'wf-1');

    await store.release('key-1');

    await expect(store.acquire('key-1', 'wf-1')).resolves.toBe(false);
  });

  it('deletes all keys for a workflow', async () => {
    await store.acquire('key-1', 'wf-1');
    await store.acquire('key-2', 'wf-1');
    await store.acquire('key-3', 'wf-2');

    await store.deleteByWorkflowId('wf-1');

    await expect(store.exists('key-1')).resolves.toBe(false);
    await expect(store.exists('key-2')).resolves.toBe(false);
    await expect(store.exists('key-3')).resolves.toBe(true);
  });
});
