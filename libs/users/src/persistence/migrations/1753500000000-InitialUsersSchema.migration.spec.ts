import { DataSource } from 'typeorm';
import { InitialUsersSchema1753500000000 } from './1753500000000-InitialUsersSchema.migration';
import { SeedUsersManagePermission1753510000000 } from './1753510000000-SeedUsersManagePermission.migration';
import { UserProfileEntity } from '../../domain/user-profile.entity';

// Auth's own migrations/entities, run alongside this library's, exactly the
// way apps/server/src/app.module.ts merges them into one DatabaseModule —
// SeedUsersManagePermission grants `users:manage` to auth's `admin` role,
// so the seed can't be exercised without auth's schema present too. Only
// AUTH_TYPEORM_ENTITIES/AUTH_MIGRATIONS (the full arrays) are part of
// libs/auth's public barrel — individual migration/entity classes aren't,
// so this pulls in auth's whole schema rather than hand-picking classes.
import { AUTH_TYPEORM_ENTITIES, AUTH_MIGRATIONS, RoleEntity } from '@/auth';

describe('InitialUsersSchema migration', () => {
  it('creates user_profiles on up() and drops it on down()', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [UserProfileEntity],
      migrations: [InitialUsersSchema1753500000000],
      synchronize: false,
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    const queryRunner = dataSource.createQueryRunner();
    expect(await queryRunner.hasTable('user_profiles')).toBe(true);

    const repo = dataSource.getRepository(UserProfileEntity);
    const saved = await repo.save({ userId: 'user-1', displayName: 'Jane' });

    expect(await repo.count()).toBe(1);
    expect(saved.deactivatedAt ?? null).toBeNull();

    await dataSource.undoLastMigration();
    expect(await queryRunner.hasTable('user_profiles')).toBe(false);

    await dataSource.destroy();
  });

  it("SeedUsersManagePermission grants 'users:manage' to the admin role auth seeds", async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [...AUTH_TYPEORM_ENTITIES, UserProfileEntity],
      migrations: [
        ...AUTH_MIGRATIONS,
        InitialUsersSchema1753500000000,
        SeedUsersManagePermission1753510000000,
      ],
      synchronize: false,
    });

    await dataSource.initialize();
    await dataSource.runMigrations();

    const roleRepo = dataSource.getRepository(RoleEntity);
    const admin = await roleRepo.findOne({
      where: { name: 'admin' },
      relations: { permissions: true },
    });

    expect(admin?.permissions.map((p) => p.name)).toEqual(
      expect.arrayContaining(['roles:manage', 'users:manage']),
    );

    await dataSource.destroy();
  });
});
