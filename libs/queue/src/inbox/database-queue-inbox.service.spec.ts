import { DataSource } from 'typeorm';
import {
  DatabaseRole,
  RepositoryResolver,
  TransactionExecutor,
} from '@/database';
import { DatabaseQueueInboxService } from './database-queue-inbox.service';
import { InboxRepository } from './inbox.repository';
import { createQueueTestDataSource } from '../testing/queue-test-datasource';

function fakeDataSourceManager(dataSource: DataSource) {
  return {
    dataSource: () => dataSource,
    manager: () => dataSource.manager,
  } as never;
}

describe('DatabaseQueueInboxService', () => {
  let dataSource: DataSource;
  let service: DatabaseQueueInboxService;

  beforeEach(async () => {
    dataSource = await createQueueTestDataSource();

    const dataSourceManager = fakeDataSourceManager(dataSource);
    const resolver = new RepositoryResolver(dataSourceManager);
    const inbox = new InboxRepository(DatabaseRole.WRITE, resolver);
    const transactionExecutor = new TransactionExecutor(dataSourceManager);

    service = new DatabaseQueueInboxService(inbox, transactionExecutor);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('runs the operation and records the message as processed on first delivery', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);

    const ran = await service.withIdempotency('queue-a', 'msg-1', operation);

    expect(ran).toBe(true);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('skips the operation as a duplicate on redelivery of the same message', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);

    await service.withIdempotency('queue-a', 'msg-1', operation);
    const ranAgain = await service.withIdempotency(
      'queue-a',
      'msg-1',
      operation,
    );

    expect(ranAgain).toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('scopes the dedup key per consumer, so different consumers can each process the same messageId', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);

    const ranForA = await service.withIdempotency(
      'queue-a',
      'msg-1',
      operation,
    );
    const ranForB = await service.withIdempotency(
      'queue-b',
      'msg-1',
      operation,
    );

    expect(ranForA).toBe(true);
    expect(ranForB).toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not collide when consumerKey/messageId concatenation would otherwise be ambiguous', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);

    const ranForFirstPair = await service.withIdempotency(
      'a:b',
      'c',
      operation,
    );
    const ranForSecondPair = await service.withIdempotency(
      'a',
      'b:c',
      operation,
    );

    expect(ranForFirstPair).toBe(true);
    expect(ranForSecondPair).toBe(true);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rolls back the inbox record when the operation throws, allowing a legitimate retry', async () => {
    const failingOperation = jest
      .fn()
      .mockRejectedValueOnce(new Error('business logic failed'))
      .mockResolvedValueOnce(undefined);

    await expect(
      service.withIdempotency('queue-a', 'msg-1', failingOperation),
    ).rejects.toThrow('business logic failed');

    const ranOnRetry = await service.withIdempotency(
      'queue-a',
      'msg-1',
      failingOperation,
    );

    expect(ranOnRetry).toBe(true);
    expect(failingOperation).toHaveBeenCalledTimes(2);
  });
});
