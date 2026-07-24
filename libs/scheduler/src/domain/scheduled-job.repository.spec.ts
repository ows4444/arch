import { DataSource } from 'typeorm';
import { DatabaseRole } from '@/database';
import { ScheduledJobRepository } from './scheduled-job.repository';
import { ScheduledJobEntity } from './scheduled-job.entity';
import { ScheduledJobMisfirePolicy } from './scheduled-job-misfire-policy.enum';
import {
  createSchedulerTestDataSource,
  fakeRepositoryResolver,
} from '../testing/scheduler-test-datasource';

describe('ScheduledJobRepository.claimDue', () => {
  let dataSource: DataSource;
  let repository: ScheduledJobRepository;

  beforeEach(async () => {
    dataSource = await createSchedulerTestDataSource();
    repository = new ScheduledJobRepository(
      DatabaseRole.WRITE,
      fakeRepositoryResolver(dataSource),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  async function insertRow(
    overrides: Partial<ScheduledJobEntity> = {},
  ): Promise<ScheduledJobEntity> {
    const repo = dataSource.getRepository(ScheduledJobEntity);

    return repo.save(
      repo.create({
        name: 'job-1',
        cronExpression: '*/5 * * * *',
        misfirePolicy: ScheduledJobMisfirePolicy.SKIP,
        enabled: true,
        nextFireAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      }),
    );
  }

  it('claims enabled, due rows up to the limit', async () => {
    await insertRow({ name: 'job-1', nextFireAt: new Date(Date.now() - 1000) });
    await insertRow({ name: 'job-2', nextFireAt: new Date(Date.now() - 500) });
    await insertRow({
      name: 'job-3',
      nextFireAt: new Date(Date.now() + 60_000),
    }); // not due yet

    const claimed = await repository.claimDue(
      'owner-1',
      new Date(),
      30_000,
      10,
    );

    expect(claimed.map((row) => row.name).sort()).toEqual(['job-1', 'job-2']);
    expect(claimed.every((row) => row.claimedBy === 'owner-1')).toBe(true);
  });

  it('respects the limit', async () => {
    await insertRow({ name: 'job-1', nextFireAt: new Date(Date.now() - 1000) });
    await insertRow({ name: 'job-2', nextFireAt: new Date(Date.now() - 1000) });

    const claimed = await repository.claimDue('owner-1', new Date(), 30_000, 1);

    expect(claimed).toHaveLength(1);
  });

  it('does not claim disabled rows', async () => {
    await insertRow({
      name: 'disabled-job',
      enabled: false,
      nextFireAt: new Date(Date.now() - 1000),
    });

    const claimed = await repository.claimDue(
      'owner-1',
      new Date(),
      30_000,
      10,
    );

    expect(claimed).toHaveLength(0);
  });

  it('does not claim rows already claimed by another owner within the stale window', async () => {
    await insertRow({
      nextFireAt: new Date(Date.now() - 1000),
      claimedBy: 'other-owner',
      claimedAt: new Date(),
    });

    const claimed = await repository.claimDue(
      'owner-1',
      new Date(),
      30_000,
      10,
    );

    expect(claimed).toHaveLength(0);
  });

  it('reclaims rows whose claim has gone stale (e.g. the owning process crashed mid-fire)', async () => {
    await insertRow({
      nextFireAt: new Date(Date.now() - 1000),
      claimedBy: 'stale-owner',
      claimedAt: new Date(Date.now() - 60_000),
    });

    const claimed = await repository.claimDue(
      'owner-1',
      new Date(),
      30_000,
      10,
    );

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.claimedBy).toBe('owner-1');
  });

  it('does not claim rows whose nextFireAt is still in the future', async () => {
    await insertRow({ nextFireAt: new Date(Date.now() + 60_000) });

    const claimed = await repository.claimDue(
      'owner-1',
      new Date(),
      30_000,
      10,
    );

    expect(claimed).toHaveLength(0);
  });

  describe('recordFired / release', () => {
    it('recordFired advances nextFireAt, stamps lastFiredAt, and clears the claim', async () => {
      await insertRow({
        claimedBy: 'owner-1',
        claimedAt: new Date(),
      });

      const firedAt = new Date();
      const nextFireAt = new Date(Date.now() + 300_000);
      await repository.recordFired('job-1', firedAt, nextFireAt);

      const row = await repository.findByName('job-1');
      expect(row?.lastFiredAt?.getTime()).toBe(firedAt.getTime());
      expect(row?.nextFireAt.getTime()).toBe(nextFireAt.getTime());
      expect(row?.claimedBy).toBeNull();
      expect(row?.claimedAt).toBeNull();
    });

    it('release clears the claim without touching nextFireAt', async () => {
      const original = await insertRow({
        claimedBy: 'owner-1',
        claimedAt: new Date(),
      });

      await repository.release('job-1');

      const row = await repository.findByName('job-1');
      expect(row?.claimedBy).toBeNull();
      expect(row?.claimedAt).toBeNull();
      expect(row?.nextFireAt.getTime()).toBe(original.nextFireAt.getTime());
    });
  });
});
