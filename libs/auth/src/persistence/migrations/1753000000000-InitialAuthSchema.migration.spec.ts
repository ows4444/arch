import { DataSource } from 'typeorm';
import { InitialAuthSchema1753000000000 } from './1753000000000-InitialAuthSchema.migration';
import { RefreshTokenDeviceId1753300000000 } from './1753300000000-RefreshTokenDeviceId.migration';
import { UserEntity } from '../../domain/user.entity';
import { RoleEntity } from '../../domain/role.entity';
import { PermissionEntity } from '../../domain/permission.entity';
import { RefreshTokenEntity } from '../../domain/refresh-token.entity';
import { UserStatus } from '../../domain/user-status.enum';

describe('InitialAuthSchema migration', () => {
  it('creates all tables (including join tables) on up() and drops them on down()', async () => {
    const dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [UserEntity, RoleEntity, PermissionEntity, RefreshTokenEntity],
      // RefreshTokenDeviceId runs alongside the initial migration (rather
      // than this spec being scoped to InitialAuthSchema alone) because
      // this test exercises real `RefreshTokenEntity` inserts against the
      // migrated schema — the entity always reflects the *current* shape,
      // so every migration that alters a table this spec touches needs to
      // run too, or the entity/schema mismatch is exactly what breaks.
      migrations: [
        InitialAuthSchema1753000000000,
        RefreshTokenDeviceId1753300000000,
      ],
      synchronize: false,
    });

    await dataSource.initialize();

    const tables = [
      'auth_users',
      'auth_roles',
      'auth_permissions',
      'auth_role_permissions',
      'auth_user_roles',
      'auth_refresh_tokens',
    ];

    await dataSource.runMigrations();

    const queryRunner = dataSource.createQueryRunner();

    for (const table of tables) {
      expect(await queryRunner.hasTable(table)).toBe(true);
    }

    // Exercise the real entity mapping against the migrated schema, not
    // just the table's existence — catches column/type mismatches between
    // the raw migration SQL and the TypeORM entity decorators.
    const userRepo = dataSource.getRepository(UserEntity);
    const roleRepo = dataSource.getRepository(RoleEntity);
    const permissionRepo = dataSource.getRepository(PermissionEntity);

    const permission = await permissionRepo.save({
      name: 'workflow:read',
    });
    const role = await roleRepo.save({
      name: 'admin',
      permissions: [permission],
    });
    const user = await userRepo.save({
      email: 'a@example.com',
      passwordHash: 'hash',
      passwordAlgo: 'argon2id',
      status: UserStatus.ACTIVE,
      roles: [role],
    });

    const loaded = await userRepo.findOne({
      where: { id: user.id },
      relations: { roles: { permissions: true } },
    });

    expect(loaded?.roles).toHaveLength(1);
    expect(loaded?.roles[0]?.permissions).toHaveLength(1);
    expect(loaded?.roles[0]?.permissions[0]?.name).toBe('workflow:read');

    const refreshTokenRepo = dataSource.getRepository(RefreshTokenEntity);
    const savedRefreshToken = await refreshTokenRepo.save({
      userId: user.id,
      tokenHash: 'hash-of-token',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 60_000),
      deviceId: 'device-abc',
      createdAt: new Date(),
    });

    expect(await refreshTokenRepo.count()).toBe(1);
    expect(savedRefreshToken.deviceId).toBe('device-abc');

    await dataSource.undoLastMigration();
    await dataSource.undoLastMigration();

    for (const table of tables) {
      expect(await queryRunner.hasTable(table)).toBe(false);
    }

    await dataSource.destroy();
  });
});
