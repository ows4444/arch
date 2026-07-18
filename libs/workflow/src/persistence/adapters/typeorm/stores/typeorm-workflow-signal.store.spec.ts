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

  it('returns false rather than throwing on a duplicate (workflowId, signalId)', async () => {
    await store.insert(record());

    await expect(store.insert(record())).resolves.toBe(false);
  });

  it('allows two different workflows to reuse the same caller-chosen signalId (regression)', async () => {
    await expect(
      store.insert(record({ workflowId: 'wf-1', signalId: 'approve' })),
    ).resolves.toBe(true);
    await expect(
      store.insert(record({ workflowId: 'wf-2', signalId: 'approve' })),
    ).resolves.toBe(true);

    const wf1Signal = await store.load('wf-1', 'approve');
    const wf2Signal = await store.load('wf-2', 'approve');

    expect(wf1Signal?.workflowId).toBe('wf-1');
    expect(wf2Signal?.workflowId).toBe('wf-2');
  });

  it("marking one workflow's signal processed does not affect another workflow sharing the same signalId (regression)", async () => {
    await store.insert(record({ workflowId: 'wf-1', signalId: 'approve' }));
    await store.insert(record({ workflowId: 'wf-2', signalId: 'approve' }));

    await store.markProcessed('wf-1', 'approve');

    await expect(store.load('wf-1', 'approve')).resolves.toMatchObject({
      processed: true,
    });
    await expect(store.load('wf-2', 'approve')).resolves.toMatchObject({
      processed: false,
    });
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

    const loaded = await store.load('wf-1', 'signal-1');

    expect(loaded?.signal.name).toBe('approval');
    expect(loaded?.signal.payload).toEqual({ ok: true });
  });

  it('returns null when the signal does not exist', async () => {
    await expect(store.load('wf-1', 'missing')).resolves.toBeNull();
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
    await store.markProcessed('wf-1', 'signal-1');

    const pending = await store.findPending('wf-1');

    expect(pending.map((s) => s.signalId)).toEqual(['signal-2']);
  });

  it('marks a signal processed', async () => {
    await store.insert(record());

    await store.markProcessed('wf-1', 'signal-1');

    const loaded = await store.load('wf-1', 'signal-1');
    expect(loaded?.processed).toBe(true);
    expect(loaded?.processedAt).toBeInstanceOf(Date);
  });

  it('deletes all signals for a workflow', async () => {
    await store.insert(record({ signalId: 'signal-1', workflowId: 'wf-1' }));
    await store.insert(record({ signalId: 'signal-2', workflowId: 'wf-2' }));

    await store.deleteByWorkflowId('wf-1');

    await expect(store.exists('wf-1', 'signal-1')).resolves.toBe(false);
    await expect(store.exists('wf-2', 'signal-2')).resolves.toBe(true);
  });
});
