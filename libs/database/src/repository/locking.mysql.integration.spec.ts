import {
  Column,
  DataSource,
  Entity,
  OptimisticLockVersionMismatchError,
  PrimaryGeneratedColumn,
  VersionColumn,
} from 'typeorm';
import { BaseRepository } from './base.repository';
import { RepositoryResolver } from './repository-resolver';
import { TransactionExecutor } from '../transaction/transaction.executor';
import { DatabaseRole } from '../constants/database-role.enum';
import type { DataSourceManager } from '../datasource/datasource.manager';

/**
 * `BaseRepository.findOneForUpdate`/`findOneForShare`/`findOneOptimistic`
 * (base.repository.ts) only have mock-backed coverage today
 * (base.repository.spec.ts) — it asserts the "requires an active
 * transaction" guard, not that the lock actually does anything. sqlite's
 * `better-sqlite3` driver is single-connection and synchronous, so it can't
 * exercise real row-level locking at all: there's no second connection for
 * a second "concurrent" transaction to block on. Requires real MySQL with a
 * connection pool to prove `pessimistic_write` actually serializes
 * conflicting writers, `pessimistic_read` allows concurrent shared readers
 * while still blocking a writer, and `findOneOptimistic` rejects a stale
 * write.
 *
 * Requires `make compose-up` and a scratch database the `app` user can
 * create tables in (see auth-concurrency.mysql.integration.spec.ts).
 * Skipped by default so `npm test` stays hermetic; run explicitly with:
 *   RUN_MYSQL_INTEGRATION_TESTS=1 npx jest locking.mysql
 */
const describeIfMysql =
  process.env.RUN_MYSQL_INTEGRATION_TESTS === '1' ? describe : describe.skip;

@Entity({ name: 'locking_test_entity' })
class LockingTestEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'int', default: 0 })
  balance!: number;

  @VersionColumn()
  version!: number;
}

class LockingTestRepository extends BaseRepository<LockingTestEntity> {
  protected readonly entity = LockingTestEntity;

  lockForUpdate(id: number) {
    return this.findOneForUpdate('t', { id });
  }

  lockForShare(id: number) {
    return this.findOneForShare('t', { id });
  }

  lockOptimistic(id: number, version: number) {
    return this.findOneOptimistic('t', { id }, version);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describeIfMysql('BaseRepository locking helpers (real MySQL)', () => {
  let dataSource: DataSource;
  let executor: TransactionExecutor;
  let repo: LockingTestRepository;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'mysql',
      host: process.env.MYSQL_HOST ?? 'localhost',
      port: Number(process.env.MYSQL_PORT ?? 3307),
      username: process.env.MYSQL_USERNAME ?? 'app',
      password: process.env.MYSQL_PASSWORD ?? 'app',
      database: 'app_scratch',
      entities: [LockingTestEntity],
      synchronize: true,
      dropSchema: true,
    });
    await dataSource.initialize();

    const dataSourceManager = {
      manager: () => dataSource.manager,
      dataSource: () => dataSource,
      repository: (entity: never) => dataSource.manager.getRepository(entity),
    } as unknown as DataSourceManager;

    executor = new TransactionExecutor(dataSourceManager);
    const resolver = new RepositoryResolver(dataSourceManager);
    repo = new LockingTestRepository(DatabaseRole.WRITE, resolver);
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('findOneForUpdate serializes concurrent writers instead of losing an update', async () => {
    const saved = await repo.save({ balance: 0 });

    const bump = () =>
      executor.execute(async () => {
        const row = await repo.lockForUpdate(saved.id);
        // Held briefly while inside the lock so a non-serialized second
        // writer has a chance to read the pre-increment value.
        await sleep(50);
        row!.balance += 1;
        await repo.save(row!);
      });

    await Promise.all([bump(), bump()]);

    const final = await repo.findOneBy({ id: saved.id });
    expect(final?.balance).toBe(2);
  });

  it('findOneForShare allows concurrent shared readers but still blocks a pessimistic writer until they finish', async () => {
    const saved = await repo.save({ balance: 0 });
    const order: string[] = [];

    const reader = (label: string) =>
      executor.execute(async () => {
        await repo.lockForShare(saved.id);
        order.push(`${label}-locked`);
        await sleep(75);
        order.push(`${label}-done`);
      });

    const writer = () =>
      executor.execute(async () => {
        // Give both readers a head start so they've both taken the shared
        // lock before the writer attempts its exclusive one.
        await sleep(25);
        const row = await repo.lockForUpdate(saved.id);
        order.push('writer-locked');
        row!.balance += 1;
        await repo.save(row!);
      });

    await Promise.all([reader('r1'), reader('r2'), writer()]);

    expect(order.indexOf('r1-locked')).toBeLessThan(order.indexOf('r1-done'));
    expect(order.indexOf('r2-locked')).toBeLessThan(order.indexOf('r2-done'));
    expect(order.indexOf('writer-locked')).toBeGreaterThan(
      order.indexOf('r1-done'),
    );
    expect(order.indexOf('writer-locked')).toBeGreaterThan(
      order.indexOf('r2-done'),
    );
  });

  it('findOneOptimistic rejects a write against a version that changed since it was read', async () => {
    const saved = await repo.save({ balance: 0 });

    const staleRead = await repo.findOneBy({ id: saved.id });

    // A concurrent writer bumps the row's version first.
    const current = await repo.findOneBy({ id: saved.id });
    current!.balance = 5;
    await repo.save(current!);

    await expect(
      repo.lockOptimistic(saved.id, staleRead!.version),
    ).rejects.toThrow(OptimisticLockVersionMismatchError);
  });
});
