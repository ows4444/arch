import { DataSource } from 'typeorm';
import { TypeOrmWorkflowHistoryStore } from './typeorm-workflow-history.store';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { TypeOrmWorkflowEntityManagerProvider } from '../typeorm-workflow-entity-manager.provider';
import { createWorkflowStepId } from '../../../../models/workflow-step-id';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';

describe('TypeOrmWorkflowHistoryStore', () => {
  let dataSource: DataSource;
  let store: TypeOrmWorkflowHistoryStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    store = new TypeOrmWorkflowHistoryStore(
      new TypeOrmWorkflowEntityManagerProvider(
        new TypeOrmWorkflowTransactionContext(),
        dataSource,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('appends and retrieves step executions for a workflow in start order', async () => {
    await store.append('wf-1', {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T00:00:01.000Z'),
      durationMs: 1000,
      status: 'completed',
    });
    await store.append('wf-1', {
      step: createWorkflowStepId('step-2'),
      startedAt: new Date('2026-01-01T00:01:00.000Z'),
      status: 'started',
    });

    const history = await store.findByWorkflowId('wf-1');

    expect(history).toHaveLength(2);
    expect(history[0]!.step).toBe('step-1');
    expect(history[0]!.durationMs).toBe(1000);
    expect(history[1]!.step).toBe('step-2');
    expect(history[1]!.status).toBe('started');
  });

  it('scopes findByWorkflowId to the given workflow', async () => {
    await store.append('wf-1', {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date(),
      status: 'completed',
    });
    await store.append('wf-2', {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date(),
      status: 'completed',
    });

    const history = await store.findByWorkflowId('wf-1');

    expect(history).toHaveLength(1);
  });

  it('returns an empty array when the workflow has no history', async () => {
    await expect(store.findByWorkflowId('missing')).resolves.toEqual([]);
  });

  it('persists an error message on a failed step execution', async () => {
    await store.append('wf-1', {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date(),
      status: 'failed',
      error: 'boom',
    });

    const history = await store.findByWorkflowId('wf-1');

    expect(history[0]!.error).toBe('boom');
  });

  it('deletes all history for a workflow', async () => {
    await store.append('wf-1', {
      step: createWorkflowStepId('step-1'),
      startedAt: new Date(),
      status: 'completed',
    });

    await store.delete('wf-1');

    await expect(store.findByWorkflowId('wf-1')).resolves.toEqual([]);
  });
});
