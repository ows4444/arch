import { DataSource } from 'typeorm';
import { TypeOrmWorkflowStateStore } from './typeorm-workflow-state.store';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { TypeOrmWorkflowEntityManagerProvider } from '../typeorm-workflow-entity-manager.provider';
import { WorkflowConcurrencyError } from '../../../../errors/workflow.errors';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';
import { createWorkflowExecutionState } from '../../../../testing/fixtures/state.factory';
import { createWorkflowStepId } from '../../../../models/workflow-step-id';

describe('TypeOrmWorkflowStateStore', () => {
  let dataSource: DataSource;
  let store: TypeOrmWorkflowStateStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    store = new TypeOrmWorkflowStateStore(
      new TypeOrmWorkflowEntityManagerProvider(
        new TypeOrmWorkflowTransactionContext(),
        dataSource,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('round-trips a workflow through insert and load', async () => {
    const state = createWorkflowExecutionState({ workflowId: 'wf-1' });

    await store.insert(state);
    const loaded = await store.load('wf-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.workflowId).toBe('wf-1');
    expect(loaded?.workflowName).toBe(state.workflowName);
    expect(loaded?.data).toEqual(state.data);
  });

  it('returns null when loading a workflow that does not exist', async () => {
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('throws a WorkflowConcurrencyError when inserting a duplicate workflowId', async () => {
    const state = createWorkflowExecutionState({ workflowId: 'wf-1' });
    await store.insert(state);

    await expect(store.insert(state)).rejects.toThrow(WorkflowConcurrencyError);
  });

  it('saves successfully when previousState.stateVersion matches the persisted row', async () => {
    const state = createWorkflowExecutionState({
      workflowId: 'wf-1',
      stateVersion: 1,
    });
    await store.insert(state);

    const next = { ...state, stateVersion: 2, status: 'completed' as const };
    const saved = await store.save(state, next);

    expect(saved.status).toBe('completed');

    const reloaded = await store.load('wf-1');
    expect(reloaded?.stateVersion).toBe(2);
    expect(reloaded?.status).toBe('completed');
  });

  it('rejects the save with WorkflowConcurrencyError when the persisted stateVersion has moved on', async () => {
    const state = createWorkflowExecutionState({
      workflowId: 'wf-1',
      stateVersion: 1,
    });
    await store.insert(state);

    const firstWriter = {
      ...state,
      stateVersion: 2,
      status: 'running' as const,
    };
    await store.save(state, firstWriter);

    const staleNext = {
      ...state,
      stateVersion: 2,
      status: 'cancelled' as const,
    };

    await expect(store.save(state, staleNext)).rejects.toThrow(
      WorkflowConcurrencyError,
    );
  });

  it('finds workflows by correlationId', async () => {
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        correlationId: 'corr-1',
      }),
    );
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        correlationId: 'corr-2',
      }),
    );

    const results = await store.findByCorrelationId('corr-1');

    expect(results).toHaveLength(1);
    expect(results[0]!.workflowId).toBe('wf-1');
  });

  it('finds only running/waiting/sleeping workflows as active', async () => {
    await store.insert(
      createWorkflowExecutionState({ workflowId: 'wf-1', status: 'running' }),
    );
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        status: 'completed',
        currentStep: undefined,
      }),
    );
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-3',
        status: 'sleeping',
        currentStep: undefined,
        sleepUntil: new Date(),
        resumeStep: createWorkflowStepId('step-1'),
      }),
    );

    const active = await store.findActive();

    expect(active.map((s) => s.workflowId).sort()).toEqual(['wf-1', 'wf-3']);
  });

  it('finds sleeping workflows whose sleepUntil has elapsed', async () => {
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-1',
        status: 'sleeping',
        currentStep: undefined,
        sleepUntil: new Date(Date.now() - 1000),
        resumeStep: createWorkflowStepId('step-1'),
      }),
    );
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'wf-2',
        status: 'sleeping',
        currentStep: undefined,
        sleepUntil: new Date(Date.now() + 60_000),
        resumeStep: createWorkflowStepId('step-1'),
      }),
    );

    const ready = await store.findSleepingReady(new Date());

    expect(ready.map((s) => s.workflowId)).toEqual(['wf-1']);
  });

  it('finds workflows by parentWorkflowId', async () => {
    await store.insert(
      createWorkflowExecutionState({
        workflowId: 'child-1',
        parentWorkflowId: 'parent-1',
      }),
    );

    const children = await store.findByParentWorkflowId('parent-1');

    expect(children).toHaveLength(1);
    expect(children[0]!.workflowId).toBe('child-1');
  });

  it('deletes a workflow', async () => {
    await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));

    await store.delete('wf-1');

    await expect(store.load('wf-1')).resolves.toBeNull();
  });

  describe('lease management', () => {
    it('acquires a lease when none is held', async () => {
      await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));

      const acquired = await store.acquireLease?.(
        'wf-1',
        'owner-a',
        new Date(Date.now() + 60_000),
      );

      expect(acquired).toBe(true);
    });

    it('refuses to acquire a lease already held by a different, unexpired owner', async () => {
      await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));
      await store.acquireLease?.(
        'wf-1',
        'owner-a',
        new Date(Date.now() + 60_000),
      );

      const acquired = await store.acquireLease?.(
        'wf-1',
        'owner-b',
        new Date(Date.now() + 60_000),
      );

      expect(acquired).toBe(false);
    });

    it('allows acquiring an expired lease held by a different owner', async () => {
      await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));
      await store.acquireLease?.(
        'wf-1',
        'owner-a',
        new Date(Date.now() - 1_000),
      );

      const acquired = await store.acquireLease?.(
        'wf-1',
        'owner-b',
        new Date(Date.now() + 60_000),
      );

      expect(acquired).toBe(true);
    });

    it('renews a lease only for the current owner', async () => {
      await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));
      await store.acquireLease?.(
        'wf-1',
        'owner-a',
        new Date(Date.now() + 60_000),
      );

      await expect(
        store.renewLease?.('wf-1', 'owner-b', new Date(Date.now() + 120_000)),
      ).resolves.toBe(false);

      await expect(
        store.renewLease?.('wf-1', 'owner-a', new Date(Date.now() + 120_000)),
      ).resolves.toBe(true);
    });

    it('releases a lease, allowing a different owner to acquire it', async () => {
      await store.insert(createWorkflowExecutionState({ workflowId: 'wf-1' }));
      await store.acquireLease?.(
        'wf-1',
        'owner-a',
        new Date(Date.now() + 60_000),
      );

      await store.releaseLease?.('wf-1', 'owner-a');

      await expect(
        store.acquireLease?.('wf-1', 'owner-b', new Date(Date.now() + 60_000)),
      ).resolves.toBe(true);
    });
  });
});
