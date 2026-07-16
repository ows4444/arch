import { DataSource } from 'typeorm';
import { TypeOrmWorkflowSignalStore } from './typeorm-workflow-signal.store';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { TypeOrmWorkflowEntityManagerProvider } from '../typeorm-workflow-entity-manager.provider';
import { WorkflowSignalRecord } from '../../../../models/workflow-signal-record';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';

function record(
  overrides: Partial<WorkflowSignalRecord> = {},
): WorkflowSignalRecord {
  return {
    signalId: 'signal-1',
    workflowId: 'wf-1',
    signal: { signalId: 'signal-1', name: 'approval' },
    processed: false,
    createdAt: new Date(),
    ...overrides,
  };
}

describe('TypeOrmWorkflowSignalStore', () => {
  let dataSource: DataSource;
  let store: TypeOrmWorkflowSignalStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    store = new TypeOrmWorkflowSignalStore(
      new TypeOrmWorkflowEntityManagerProvider(
        new TypeOrmWorkflowTransactionContext(),
        dataSource,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('inserts a new signal record', async () => {
    await expect(store.insert(record())).resolves.toBe(true);
  });

  it('returns false rather than throwing on a duplicate signalId', async () => {
    await store.insert(record());

    await expect(store.insert(record())).resolves.toBe(false);
  });

  it('round-trips a signal through load', async () => {
    await store.insert(
      record({
        signal: {
          signalId: 'signal-1',
          name: 'approval',
          payload: { ok: true },
        },
      }),
    );

    const loaded = await store.load('signal-1');

    expect(loaded?.signal.name).toBe('approval');
    expect(loaded?.signal.payload).toEqual({ ok: true });
  });

  it('returns null when the signal does not exist', async () => {
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('reports pending (unprocessed) signals for a workflow in creation order', async () => {
    await store.insert(
      record({
        signalId: 'signal-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    );
    await store.insert(
      record({
        signalId: 'signal-2',
        createdAt: new Date('2026-01-01T00:01:00.000Z'),
      }),
    );
    await store.markProcessed('signal-1');

    const pending = await store.findPending('wf-1');

    expect(pending.map((s) => s.signalId)).toEqual(['signal-2']);
  });

  it('marks a signal processed', async () => {
    await store.insert(record());

    await store.markProcessed('signal-1');

    const loaded = await store.load('signal-1');
    expect(loaded?.processed).toBe(true);
    expect(loaded?.processedAt).toBeInstanceOf(Date);
  });

  it('deletes all signals for a workflow', async () => {
    await store.insert(record({ signalId: 'signal-1', workflowId: 'wf-1' }));
    await store.insert(record({ signalId: 'signal-2', workflowId: 'wf-2' }));

    await store.deleteByWorkflowId('wf-1');

    await expect(store.exists('signal-1')).resolves.toBe(false);
    await expect(store.exists('signal-2')).resolves.toBe(true);
  });
});
