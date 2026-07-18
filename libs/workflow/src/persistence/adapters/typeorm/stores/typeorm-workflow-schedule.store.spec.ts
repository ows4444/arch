import { DataSource } from 'typeorm';
import { TypeOrmWorkflowScheduleStore } from './typeorm-workflow-schedule.store';
import { TypeOrmWorkflowTransactionContext } from './typeorm-workflow-transaction-context';
import { TypeOrmWorkflowEntityManagerProvider } from '../typeorm-workflow-entity-manager.provider';
import { WorkflowConcurrencyError } from '../../../../errors/workflow.errors';
import { WorkflowSchedule } from '../../../../models/workflow-schedule';
import { createTestDataSource } from '../../../../testing/typeorm-test-datasource';

function schedule(overrides: Partial<WorkflowSchedule> = {}): WorkflowSchedule {
  const now = new Date();

  return {
    scheduleId: 'sched-1',
    workflowName: 'test-workflow',
    cronExpression: '*/5 * * * *',
    inputTemplate: { foo: 'bar' },
    enabled: true,
    nextFireAt: now,
    misfirePolicy: 'skip',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('TypeOrmWorkflowScheduleStore', () => {
  let dataSource: DataSource;
  let store: TypeOrmWorkflowScheduleStore;

  beforeEach(async () => {
    dataSource = await createTestDataSource();
    store = new TypeOrmWorkflowScheduleStore(
      new TypeOrmWorkflowEntityManagerProvider(
        new TypeOrmWorkflowTransactionContext(),
        dataSource,
      ),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('round-trips a schedule through insert and load', async () => {
    await store.insert(schedule());

    const loaded = await store.load('sched-1');

    expect(loaded).not.toBeNull();
    expect(loaded?.workflowName).toBe('test-workflow');
    expect(loaded?.inputTemplate).toEqual({ foo: 'bar' });
  });

  it('returns null when loading a schedule that does not exist', async () => {
    await expect(store.load('missing')).resolves.toBeNull();
  });

  it('throws WorkflowConcurrencyError when inserting a duplicate scheduleId', async () => {
    await store.insert(schedule());

    await expect(store.insert(schedule())).rejects.toThrow(
      WorkflowConcurrencyError,
    );
  });

  it('lists all schedules', async () => {
    await store.insert(schedule({ scheduleId: 's-1' }));
    await store.insert(schedule({ scheduleId: 's-2' }));

    const all = await store.findAll();

    expect(all.map((s) => s.scheduleId).sort()).toEqual(['s-1', 's-2']);
  });

  it('toggles enabled via setEnabled', async () => {
    await store.insert(schedule({ enabled: true }));

    await store.setEnabled('sched-1', false);

    expect((await store.load('sched-1'))?.enabled).toBe(false);
  });

  it('deletes a schedule', async () => {
    await store.insert(schedule());

    await store.delete('sched-1');

    await expect(store.load('sched-1')).resolves.toBeNull();
  });

  describe('claimDue', () => {
    it('claims a due, enabled, unclaimed schedule', async () => {
      await store.insert(schedule({ nextFireAt: new Date(Date.now() - 1000) }));

      const claimed = await store.claimDue('owner-a', new Date(), 60_000);

      expect(claimed).toHaveLength(1);
      expect(claimed[0]!.claimedBy).toBe('owner-a');
    });

    it('does not claim a disabled schedule', async () => {
      await store.insert(
        schedule({
          enabled: false,
          nextFireAt: new Date(Date.now() - 1000),
        }),
      );

      const claimed = await store.claimDue('owner-a', new Date(), 60_000);

      expect(claimed).toHaveLength(0);
    });

    it('does not claim a schedule whose nextFireAt is in the future', async () => {
      await store.insert(
        schedule({ nextFireAt: new Date(Date.now() + 60_000) }),
      );

      const claimed = await store.claimDue('owner-a', new Date(), 60_000);

      expect(claimed).toHaveLength(0);
    });

    it('does not re-claim a schedule already claimed within the stale window', async () => {
      await store.insert(schedule({ nextFireAt: new Date(Date.now() - 1000) }));
      await store.claimDue('owner-a', new Date(), 60_000);

      const secondClaim = await store.claimDue('owner-b', new Date(), 60_000);

      expect(secondClaim).toHaveLength(0);
    });

    it('reclaims a schedule whose prior claim is stale', async () => {
      await store.insert(schedule({ nextFireAt: new Date(Date.now() - 1000) }));
      await store.claimDue('owner-a', new Date(Date.now() - 120_000), 60_000);

      const reclaimed = await store.claimDue('owner-b', new Date(), 60_000);

      expect(reclaimed).toHaveLength(1);
      expect(reclaimed[0]!.claimedBy).toBe('owner-b');
    });
  });

  describe('recordFired / release', () => {
    it('records a fire, advancing nextFireAt and clearing the claim', async () => {
      await store.insert(schedule({ nextFireAt: new Date(Date.now() - 1000) }));
      await store.claimDue('owner-a', new Date(), 60_000);

      const firedAt = new Date();
      const nextFireAt = new Date(Date.now() + 300_000);
      await store.recordFired('sched-1', firedAt, nextFireAt);

      const reloaded = await store.load('sched-1');
      expect(reloaded?.lastFiredAt?.getTime()).toBe(firedAt.getTime());
      expect(reloaded?.nextFireAt.getTime()).toBe(nextFireAt.getTime());
      expect(reloaded?.claimedBy).toBeUndefined();
    });

    it('releases a claim without advancing nextFireAt', async () => {
      const originalNextFireAt = new Date(Date.now() - 1000);
      await store.insert(schedule({ nextFireAt: originalNextFireAt }));
      await store.claimDue('owner-a', new Date(), 60_000);

      await store.release('sched-1');

      const reloaded = await store.load('sched-1');
      expect(reloaded?.claimedBy).toBeUndefined();
      expect(reloaded?.nextFireAt.getTime()).toBe(originalNextFireAt.getTime());
    });
  });
});
