import 'reflect-metadata';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { ScheduledJobRegistry } from './scheduled-job.registry';
import { ScheduledJob } from '../decorators/scheduled-job.decorator';
import { ScheduledJobMisfirePolicy } from '../domain/scheduled-job-misfire-policy.enum';
import type { ScheduledJobEntity } from '../domain/scheduled-job.entity';
import { SchedulerConfigurationError } from '../errors/scheduler-configuration.error';

class NightlyCleanup {
  @ScheduledJob('nightly-cleanup', '0 2 * * *', { timezone: 'UTC' })
  run(): void {
    // no-op
  }
}

class HourlyDigest {
  @ScheduledJob('hourly-digest', '0 * * * *')
  run(): void {
    // no-op
  }
}

class DuplicateOfNightlyCleanup {
  @ScheduledJob('nightly-cleanup', '0 3 * * *')
  run(): void {
    // no-op
  }
}

class PlainService {
  run(): void {
    // not a job — no @ScheduledJob metadata
  }
}

function fakeDiscovery(instances: object[]): DiscoveryService {
  return {
    getProviders: jest
      .fn()
      .mockReturnValue(instances.map((instance) => ({ instance }))),
  } as unknown as DiscoveryService;
}

function setup(instances: object[]) {
  const jobs = {
    findByName: jest
      .fn<Promise<Partial<ScheduledJobEntity> | null>, [string]>()
      .mockResolvedValue(null),
    save: jest
      .fn<Promise<void>, [Partial<ScheduledJobEntity>]>()
      .mockResolvedValue(undefined),
  };

  const registry = new ScheduledJobRegistry(
    fakeDiscovery(instances),
    new MetadataScanner(),
    new Reflector(),
    jobs as never,
  );

  return { registry, jobs };
}

describe('ScheduledJobRegistry', () => {
  it('registers a definition for each @ScheduledJob-decorated method', async () => {
    const { registry } = setup([new NightlyCleanup(), new HourlyDigest()]);

    await registry.onApplicationBootstrap();

    expect(registry.getDefinition('nightly-cleanup')).toBeDefined();
    expect(registry.getDefinition('hourly-digest')).toBeDefined();
  });

  it('ignores providers with no @ScheduledJob-decorated methods', async () => {
    const { registry } = setup([new PlainService()]);

    await registry.onApplicationBootstrap();

    expect(registry.getDefinition('anything')).toBeUndefined();
  });

  it('throws SchedulerConfigurationError when two jobs share the same name', async () => {
    const { registry } = setup([
      new NightlyCleanup(),
      new DuplicateOfNightlyCleanup(),
    ]);

    await expect(registry.onApplicationBootstrap()).rejects.toThrow(
      SchedulerConfigurationError,
    );
  });

  it('binds the invoke function to the original instance', async () => {
    class StatefulJob {
      public receivedThis: unknown;

      @ScheduledJob('stateful', '* * * * *')
      run(): void {
        this.receivedThis = this;
      }
    }

    const instance = new StatefulJob();
    const { registry } = setup([instance]);

    await registry.onApplicationBootstrap();
    void registry.getDefinition('stateful')?.invoke();

    expect(instance.receivedThis).toBe(instance);
  });

  it('skips providers with no instance (e.g. unresolved request-scoped providers)', async () => {
    const jobs = { findByName: jest.fn(), save: jest.fn() };
    const registry = new ScheduledJobRegistry(
      {
        getProviders: jest.fn().mockReturnValue([{ instance: undefined }]),
      } as unknown as DiscoveryService,
      new MetadataScanner(),
      new Reflector(),
      jobs as never,
    );

    await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();
    expect(jobs.findByName).not.toHaveBeenCalled();
  });

  describe('DB sync on discovery', () => {
    it('inserts a new row for a job with no existing DB row', async () => {
      const { registry, jobs } = setup([new NightlyCleanup()]);
      jobs.findByName.mockResolvedValue(null);

      await registry.onApplicationBootstrap();

      expect(jobs.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'nightly-cleanup',
          cronExpression: '0 2 * * *',
          timezone: 'UTC',
          misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
          enabled: true,
        }),
      );
    });

    it('recovers from a duplicate-key race against another replica booting concurrently', async () => {
      const { registry, jobs } = setup([new NightlyCleanup()]);
      const raceWinner = {
        name: 'nightly-cleanup',
        cronExpression: '0 2 * * *',
        timezone: 'UTC',
        misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
        enabled: true,
        nextFireAt: new Date(),
      };
      jobs.findByName
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raceWinner);

      const duplicateError: QueryFailedError = Object.assign(
        Object.create(QueryFailedError.prototype) as QueryFailedError,
        { driverError: { code: 'ER_DUP_ENTRY' } },
      );
      jobs.save
        .mockRejectedValueOnce(duplicateError)
        .mockResolvedValue(undefined);

      await expect(registry.onApplicationBootstrap()).resolves.toBeUndefined();
      // Second save call is the metadata-sync path after recovering from the race.
      expect(jobs.save).toHaveBeenCalledTimes(2);
    });

    it('does not recompute nextFireAt when the cron expression/timezone are unchanged', async () => {
      const { registry, jobs } = setup([new NightlyCleanup()]);
      const existingNextFireAt = new Date('2026-01-01T02:00:00.000Z');
      jobs.findByName.mockResolvedValue({
        name: 'nightly-cleanup',
        cronExpression: '0 2 * * *',
        timezone: 'UTC',
        misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
        enabled: true,
        nextFireAt: existingNextFireAt,
        lastFiredAt: null,
        claimedBy: null,
        claimedAt: null,
      });

      await registry.onApplicationBootstrap();

      expect(jobs.save).toHaveBeenCalledWith(
        expect.objectContaining({ nextFireAt: existingNextFireAt }),
      );
    });

    it('recomputes nextFireAt when the cron expression changed', async () => {
      const { registry, jobs } = setup([new NightlyCleanup()]);
      const staleNextFireAt = new Date('2026-01-01T03:00:00.000Z');
      jobs.findByName.mockResolvedValue({
        name: 'nightly-cleanup',
        cronExpression: '0 3 * * *', // stored expression differs from the decorator's '0 2 * * *'
        timezone: 'UTC',
        misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
        enabled: true,
        nextFireAt: staleNextFireAt,
        lastFiredAt: null,
        claimedBy: null,
        claimedAt: null,
      });

      await registry.onApplicationBootstrap();

      const savedArg = jobs.save.mock.calls[0]?.[0];
      expect(savedArg?.nextFireAt?.getTime()).not.toBe(
        staleNextFireAt.getTime(),
      );
    });
  });
});
