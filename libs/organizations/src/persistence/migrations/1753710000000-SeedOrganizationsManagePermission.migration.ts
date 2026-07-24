import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

/**
 * Seeds the `organizations:manage` permission and grants it to the existing
 * `admin` role (created by `libs/auth`'s `SeedRolesManagePermission`
 * migration — this migration must run after it, which
 * `apps/server/src/app.module.ts` ensures by listing `AUTH_MIGRATIONS`
 * before `ORGANIZATIONS_MIGRATIONS`). Mirrors `libs/users`'
 * `SeedUsersManagePermission` precedent exactly: no auto-grant to any real
 * user, only to the bootstrap `admin` role.
 */
export class SeedOrganizationsManagePermission1753710000000 implements MigrationInterface {
  name = 'SeedOrganizationsManagePermission1753710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionId = randomUUID();

    await queryRunner.query(
      'INSERT INTO `auth_permissions` (`id`, `name`, `description`) VALUES (?, ?, ?)',
      [
        permissionId,
        'organizations:manage',
        'Manage any organization and its memberships regardless of membership role (libs/organizations).',
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
      "DELETE FROM `auth_role_permissions` WHERE `permissionId` IN (SELECT `id` FROM `auth_permissions` WHERE `name` = 'organizations:manage')",
    );
    await queryRunner.query(
      "DELETE FROM `auth_permissions` WHERE `name` = 'organizations:manage'",
    );
  }
}
