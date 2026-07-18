import { WorkflowSchedulerService } from './scheduler.service';
import { WorkflowSchedule } from '../../models/workflow-schedule';

function schedule(overrides: Partial<WorkflowSchedule> = {}): WorkflowSchedule {
  return {
    scheduleId: 'sched-1',
    workflowName: 'test-workflow',
    cronExpression: '*/5 * * * *',
    inputTemplate: { foo: 'bar' },
    enabled: true,
    nextFireAt: new Date(),
    misfirePolicy: 'skip',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const store = {
    claimDue: jest.fn().mockResolvedValue([]),
    recordFired: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const executor = { execute: jest.fn().mockResolvedValue(undefined) };
  const registration = {
    computeNextFireAt: jest
      .fn()
      .mockReturnValue(new Date(Date.now() + 300_000)),
  };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };

  const service = new WorkflowSchedulerService(
    store as never,
    executor as never,
    registration as never,
    scheduler as never,
  );

  return { service, store, executor, registration, scheduler };
}

describe('WorkflowSchedulerService', () => {
  describe('onModuleInit / onModuleDestroy', () => {
    it('registers an unref-ed sweep interval', () => {
      const { service, scheduler } = setup();

      service.onModuleInit();

      expect(scheduler.addInterval).toHaveBeenCalledWith(
        'workflow-scheduler-sweep',
        expect.anything(),
      );
    });

    it('removes the interval on destroy without throwing if none was registered', () => {
      const { service, scheduler } = setup();
      scheduler.deleteInterval.mockImplementation(() => {
        throw new Error('not found');
      });

      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('sweep', () => {
    it('fires the workflow for each on-time claimed schedule and records the next fire time', async () => {
      const { service, store, executor, registration } = setup();
      const due = schedule({ nextFireAt: new Date() });
      store.claimDue.mockResolvedValue([due]);

      await service.sweep();

      expect(executor.execute).toHaveBeenCalledWith(
        'test-workflow',
        { foo: 'bar' },
        {
          workflowVersion: undefined,
        },
      );
      expect(store.recordFired).toHaveBeenCalledWith(
        'sched-1',
        expect.any(Date),
        registration.computeNextFireAt.mock.results[0]!.value,
      );
    });

    it('skips firing a missed schedule when misfirePolicy is skip', async () => {
      const { service, store, executor } = setup();
      const missed = schedule({
        nextFireAt: new Date(Date.now() - 10 * 60_000),
        misfirePolicy: 'skip',
      });
      store.claimDue.mockResolvedValue([missed]);

      await service.sweep();

      expect(executor.execute).not.toHaveBeenCalled();
      expect(store.recordFired).toHaveBeenCalled();
    });

    it('fires a missed schedule once when misfirePolicy is fire-once', async () => {
      const { service, store, executor } = setup();
      const missed = schedule({
        nextFireAt: new Date(Date.now() - 10 * 60_000),
        misfirePolicy: 'fire-once',
      });
      store.claimDue.mockResolvedValue([missed]);

      await service.sweep();

      expect(executor.execute).toHaveBeenCalledTimes(1);
    });

    it('releases the claim without recording a fire when execute() throws', async () => {
      const { service, store, executor } = setup();
      store.claimDue.mockResolvedValue([schedule()]);
      executor.execute.mockRejectedValue(new Error('boom'));

      await service.sweep();

      expect(store.release).toHaveBeenCalledWith('sched-1');
      expect(store.recordFired).not.toHaveBeenCalled();
    });

    it('processes multiple claimed schedules independently', async () => {
      const { service, store, executor } = setup();
      store.claimDue.mockResolvedValue([
        schedule({ scheduleId: 'a' }),
        schedule({ scheduleId: 'b' }),
      ]);

      await service.sweep();

      expect(executor.execute).toHaveBeenCalledTimes(2);
    });
  });
});
