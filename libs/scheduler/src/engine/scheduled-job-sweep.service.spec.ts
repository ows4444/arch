import { ScheduledJobSweepService } from './scheduled-job-sweep.service';
import { ScheduledJobEntity } from '../domain/scheduled-job.entity';
import { ScheduledJobMisfirePolicy } from '../domain/scheduled-job-misfire-policy.enum';

function job(overrides: Partial<ScheduledJobEntity> = {}): ScheduledJobEntity {
  return {
    name: 'nightly-cleanup',
    cronExpression: '*/5 * * * *',
    timezone: null,
    misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
    enabled: true,
    nextFireAt: new Date(),
    lastFiredAt: null,
    claimedBy: null,
    claimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function setup() {
  const jobs = {
    claimDue: jest.fn().mockResolvedValue([]),
    recordFired: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
  };
  const invoke = jest.fn().mockResolvedValue(undefined);
  const registry = {
    getDefinition: jest.fn().mockReturnValue({
      metadata: {
        name: 'nightly-cleanup',
        cronExpression: '*/5 * * * *',
        misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
        enabled: true,
      },
      invoke,
    }),
  };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };

  const service = new ScheduledJobSweepService(
    jobs as never,
    registry as never,
    scheduler as never,
    {},
  );

  return { service, jobs, invoke, registry, scheduler };
}

describe('ScheduledJobSweepService', () => {
  describe('onModuleInit / onModuleDestroy', () => {
    it('registers an unref-ed sweep interval', () => {
      const { service, scheduler } = setup();

      service.onModuleInit();

      expect(scheduler.addInterval).toHaveBeenCalledWith(
        'scheduled-job-sweep',
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
    it('invokes the handler for each on-time claimed job and records the next fire time', async () => {
      const { service, jobs, invoke } = setup();
      const due = job({ nextFireAt: new Date() });
      jobs.claimDue.mockResolvedValue([due]);

      await service.sweep();

      expect(invoke).toHaveBeenCalledTimes(1);
      expect(jobs.recordFired).toHaveBeenCalledWith(
        'nightly-cleanup',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('skips invoking a missed job when misfirePolicy is skip, but still advances nextFireAt', async () => {
      const { service, jobs, invoke, registry } = setup();
      const missed = job({ nextFireAt: new Date(Date.now() - 10 * 60_000) });
      jobs.claimDue.mockResolvedValue([missed]);
      registry.getDefinition.mockReturnValue({
        metadata: {
          name: 'nightly-cleanup',
          cronExpression: '*/5 * * * *',
          misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
          enabled: true,
        },
        invoke,
      });

      await service.sweep();

      expect(invoke).not.toHaveBeenCalled();
      expect(jobs.recordFired).toHaveBeenCalled();
    });

    it('invokes a missed job once when misfirePolicy is fire-once', async () => {
      const { service, jobs, invoke, registry } = setup();
      const missed = job({ nextFireAt: new Date(Date.now() - 10 * 60_000) });
      jobs.claimDue.mockResolvedValue([missed]);
      registry.getDefinition.mockReturnValue({
        metadata: {
          name: 'nightly-cleanup',
          cronExpression: '*/5 * * * *',
          misfirePolicy: ScheduledJobMisfirePolicy.FIRE_ONCE,
          enabled: true,
        },
        invoke,
      });

      await service.sweep();

      expect(invoke).toHaveBeenCalledTimes(1);
    });

    it('releases the claim without recording a fire when the handler throws', async () => {
      const { service, jobs, invoke } = setup();
      jobs.claimDue.mockResolvedValue([job()]);
      invoke.mockRejectedValue(new Error('boom'));

      await service.sweep();

      expect(jobs.release).toHaveBeenCalledWith('nightly-cleanup');
      expect(jobs.recordFired).not.toHaveBeenCalled();
    });

    it('advances past the fire time instead of hot-looping when no handler is registered (orphaned row)', async () => {
      // Regression test for a Loop 002 review finding: releasing without
      // advancing nextFireAt would leave the row immediately reclaimable —
      // every replica runs the same code, so if this one has no handler,
      // none do, and the row would be reclaimed and logged again on every
      // single sweep forever instead of once.
      const { service, jobs, invoke, registry } = setup();
      jobs.claimDue.mockResolvedValue([job({ name: 'removed-job' })]);
      registry.getDefinition.mockReturnValue(undefined);

      await service.sweep();

      expect(invoke).not.toHaveBeenCalled();
      expect(jobs.release).not.toHaveBeenCalled();
      expect(jobs.recordFired).toHaveBeenCalledWith(
        'removed-job',
        expect.any(Date),
        expect.any(Date),
      );
    });

    it('does nothing when no jobs are due', async () => {
      const { service, jobs, invoke } = setup();
      jobs.claimDue.mockResolvedValue([]);

      await service.sweep();

      expect(invoke).not.toHaveBeenCalled();
      expect(jobs.recordFired).not.toHaveBeenCalled();
      expect(jobs.release).not.toHaveBeenCalled();
    });
  });
});
