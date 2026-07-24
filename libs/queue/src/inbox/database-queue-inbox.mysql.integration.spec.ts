import { DataSource } from 'typeorm';
import {
  DatabaseRole,
  RepositoryResolver,
  TransactionExecutor,
} from '@/database';
import { DatabaseQueueInboxService } from './database-queue-inbox.service';
import { InboxRepository } from './inbox.repository';
import { QUEUE_TYPEORM_ENTITIES } from '../persistence/entities';

/**
 * Same regression as `database-queue-inbox.service.spec.ts`'s
 * consumerKey/messageId collision test (libs/queue/LOOP.md's inbox-dedup-key
 * fix), but against real MySQL instead of in-memory sqlite. The fix's
 * correctness depends on `isDuplicateKeyError` correctly recognizing
 * MySQL's real `ER_DUP_ENTRY` driver error code on the JSON-encoded `id`
 * column's unique/primary-key constraint — sqlite's constraint violation
 * codes (`SQLITE_CONSTRAINT_PRIMARYKEY`) are a different code path through
 * the same function, so a sqlite-only test can't prove the MySQL branch is
 * actually reachable end-to-end (real driver error shape, real primary key
 * constraint enforcement).
 *
 * Requires `make compose-up` and the `app_scratch` scratch schema (see
 * `libs/auth/LOOP.md` Loop 019 for provisioning). Skipped by default so
 * `npm test` stays hermetic; run explicitly with:
 *   RUN_MYSQL_INTEGRATION_TESTS=1 npx jest database-queue-inbox.mysql
 */
const describeIfMysql =
  process.env.RUN_MYSQL_INTEGRATION_TESTS === '1' ? describe : describe.skip;

function fakeDataSourceManager(dataSource: DataSource) {
  return {
    dataSource: () => dataSource,
    manager: () => dataSource.manager,
  } as never;
}

describeIfMysql('DatabaseQueueInboxService (real MySQL)', () => {
  let dataSource: DataSource;
  let service: DatabaseQueueInboxService;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? 'localhost',
      port: Number(process.env.MYSQL_PORT ?? 3307),
      username: process.env.MYSQL_USERNAME ?? 'app',
      password: process.env.MYSQL_PASSWORD ?? 'app',
      database: 'app_scratch',
      entities: [...QUEUE_TYPEORM_ENTITIES],
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(() => {
    const dataSourceManager = fakeDataSourceManager(dataSource);
    const resolver = new RepositoryResolver(dataSourceManager);
    const inbox = new InboxRepository(DatabaseRole.WRITE, resolver);
    const transactionExecutor = new TransactionExecutor(dataSourceManager);

    service = new DatabaseQueueInboxService(inbox, transactionExecutor);
  });

  afterEach(async () => {
    await dataSource.query('DELETE FROM queue_inbox');
  });

  it('does not collide when consumerKey/messageId concatenation would otherwise be ambiguous, against a real MySQL unique constraint', async () => {
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

  it('treats a real duplicate delivery as already-processed via a genuine ER_DUP_ENTRY, not a mocked error', async () => {
    const operation = jest.fn().mockResolvedValue(undefined);

    const ranFirst = await service.withIdempotency(
      'queue-a',
      'msg-1',
      operation,
    );
    const ranSecond = await service.withIdempotency(
      'queue-a',
      'msg-1',
      operation,
    );

    expect(ranFirst).toBe(true);
    expect(ranSecond).toBe(false);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
