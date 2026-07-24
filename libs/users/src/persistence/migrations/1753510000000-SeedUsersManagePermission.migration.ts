import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

/**
 * Seeds the `users:manage` permission and grants it to the existing `admin`
 * role (created by `libs/auth`'s `SeedRolesManagePermission` migration —
 * this migration must run after it, which `apps/server/src/app.module.ts`
 * ensures by listing `AUTH_MIGRATIONS` before `USERS_MIGRATIONS`). Mirrors
 * `libs/auth/ARCH.md`'s own precedent: no auto-grant to any actual user,
 * only to the bootstrap `admin` role — granting a real user that role
 * remains the same manual/ops step `libs/auth`'s migration already
 * documents.
 */
export class SeedUsersManagePermission1753510000000 implements MigrationInterface {
  name = 'SeedUsersManagePermission1753510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionId = randomUUID();

    await queryRunner.query(
      'INSERT INTO `auth_permissions` (`id`, `name`, `description`) VALUES (?, ?, ?)',
      [
        permissionId,
        'users:manage',
        "View any user's profile regardless of ownership (libs/users).",
      ],
    );

    const adminRole = (await queryRunner.query(
      'SELECT `id` FROM `auth_roles` WHERE `name` = ?',
      ['admin'],
    )) as Array<{ id: string }>;

    if (adminRole.length > 0) {
      await queryRunner.query(
        'INSERT INTO `auth_role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)',
        [adminRole[0]!.id, permissionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `auth_role_permissions` WHERE `permissionId` IN (SELECT `id` FROM `auth_permissions` WHERE `name` = 'users:manage')",
    );
    await queryRunner.query(
      "DELETE FROM `auth_permissions` WHERE `name` = 'users:manage'",
    );
  }
}
