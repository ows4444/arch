import { MigrationInterface, QueryRunner } from 'typeorm';
import { randomUUID } from 'node:crypto';

/**
 * Seeds the `roles:manage` permission and an `admin` role granting it, so
 * the RBAC management endpoints (`RoleController`) have something to
 * bootstrap from. Deliberately does **not** assign the `admin` role to any
 * user — auto-granting it to (say) the first registered user would be a
 * real security decision made silently. Granting the first real admin is a
 * manual/ops step: `UPDATE auth_user_roles ...` or calling
 * `AuthorizationService.assignRole(userId, 'admin')` directly once a user
 * exists (see libs/auth/ARCH.md and RoleController's class doc).
 */
export class SeedRolesManagePermission1753100000000 implements MigrationInterface {
  name = 'SeedRolesManagePermission1753100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const permissionId = randomUUID();
    const roleId = randomUUID();

    await queryRunner.query(
      'INSERT INTO `auth_permissions` (`id`, `name`, `description`) VALUES (?, ?, ?)',
      [
        permissionId,
        'roles:manage',
        'Create/list roles and permissions, assign/revoke roles on users.',
      ],
    );

    await queryRunner.query(
      'INSERT INTO `auth_roles` (`id`, `name`) VALUES (?, ?)',
      [roleId, 'admin'],
    );

    await queryRunner.query(
      'INSERT INTO `auth_role_permissions` (`roleId`, `permissionId`) VALUES (?, ?)',
      [roleId, permissionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DELETE FROM `auth_role_permissions` WHERE `roleId` IN (SELECT `id` FROM `auth_roles` WHERE `name` = 'admin')",
    );
    await queryRunner.query("DELETE FROM `auth_roles` WHERE `name` = 'admin'");
    await queryRunner.query(
      "DELETE FROM `auth_permissions` WHERE `name` = 'roles:manage'",
    );
  }
}
