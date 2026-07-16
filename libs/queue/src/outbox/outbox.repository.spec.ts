import { DataSource } from 'typeorm';
import { DatabaseRole } from '@/database';
import { OutboxRepository } from './outbox.repository';
import { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';
import {
  createQueueTestDataSource,
  fakeRepositoryResolver,
} from '../testing/queue-test-datasource';

describe('OutboxRepository.claimBatch', () => {
  let dataSource: DataSource;
  let repository: OutboxRepository;

  beforeEach(async () => {
    dataSource = await createQueueTestDataSource();
    repository = new OutboxRepository(
      DatabaseRole.WRITE,
      fakeRepositoryResolver(dataSource),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  async function insertRow(
    overrides: Partial<QueueOutboxEntity> = {},
  ): Promise<QueueOutboxEntity> {
    const repo = dataSource.getRepository(QueueOutboxEntity);

    return repo.save(
      repo.create({
        messageId: 'm-1',
        exchange: 'ex',
        routingKey: 'rk',
        payload: { a: 1 },
        status: 'pending',
        attempts: 0,
        createdAt: new Date(),
        ...overrides,
      }),
    );
  }

  it('claims pending rows up to the batch size, ordered by createdAt', async () => {
    await insertRow({
      messageId: 'm-1',
      createdAt: new Date(Date.now() - 2000),
    });
    await insertRow({
      messageId: 'm-2',
      createdAt: new Date(Date.now() - 1000),
    });
    await insertRow({ messageId: 'm-3', createdAt: new Date() });

    const claimed = await repository.claimBatch('owner-1', 2, 30_000);

    expect(claimed.map((row) => row.messageId)).toEqual(['m-1', 'm-2']);
    expect(
      claimed.every(
        (row) => row.status === 'publishing' && row.claimedBy === 'owner-1',
      ),
    ).toBe(true);
  });

  it('does not claim rows already claimed by another owner within the lease window', async () => {
    await insertRow({
      status: 'publishing',
      claimedBy: 'other-owner',
      claimedAt: new Date(),
    });

    const claimed = await repository.claimBatch('owner-1', 10, 30_000);

    expect(claimed).toHaveLength(0);
  });

  it('reclaims rows whose lease has expired (e.g. the owning process crashed mid-dispatch)', async () => {
    await insertRow({
      status: 'publishing',
      claimedBy: 'stale-owner',
      claimedAt: new Date(Date.now() - 60_000),
    });

    const claimed = await repository.claimBatch('owner-1', 10, 30_000);

    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.claimedBy).toBe('owner-1');
  });

  it('does not claim rows whose backoff has not yet elapsed', async () => {
    await insertRow({ nextAttemptAt: new Date(Date.now() + 60_000) });

    const claimed = await repository.claimBatch('owner-1', 10, 30_000);

    expect(claimed).toHaveLength(0);
  });

  it('claims a row whose backoff has elapsed', async () => {
    await insertRow({ nextAttemptAt: new Date(Date.now() - 1000) });

    const claimed = await repository.claimBatch('owner-1', 10, 30_000);

    expect(claimed).toHaveLength(1);
  });

  it('never claims already-published or permanently-failed rows', async () => {
    await insertRow({ messageId: 'published', status: 'published' });
    await insertRow({ messageId: 'failed', status: 'failed' });

    const claimed = await repository.claimBatch('owner-1', 10, 30_000);

    expect(claimed).toHaveLength(0);
  });
});
