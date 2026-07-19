import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class InitialAuthSchema1753000000000 implements MigrationInterface {
  name = 'InitialAuthSchema1753000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'auth_users',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'email', type: 'varchar', isUnique: true },
          { name: 'passwordHash', type: 'varchar' },
          { name: 'passwordAlgo', type: 'varchar' },
          { name: 'status', type: 'varchar', default: "'active'" },
          { name: 'emailVerifiedAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
          { name: 'updatedAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_roles',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'name', type: 'varchar', isUnique: true },
          { name: 'description', type: 'varchar', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_permissions',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'name', type: 'varchar', isUnique: true },
          { name: 'description', type: 'varchar', isNullable: true },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_role_permissions',
        columns: [
          { name: 'roleId', type: 'varchar', isPrimary: true },
          { name: 'permissionId', type: 'varchar', isPrimary: true },
        ],
        foreignKeys: [
          {
            columnNames: ['roleId'],
            referencedTableName: 'auth_roles',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['permissionId'],
            referencedTableName: 'auth_permissions',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_user_roles',
        columns: [
          { name: 'userId', type: 'varchar', isPrimary: true },
          { name: 'roleId', type: 'varchar', isPrimary: true },
        ],
        foreignKeys: [
          {
            columnNames: ['userId'],
            referencedTableName: 'auth_users',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
          {
            columnNames: ['roleId'],
            referencedTableName: 'auth_roles',
            referencedColumnNames: ['id'],
            onDelete: 'CASCADE',
          },
        ],
      }),
    );

    await queryRunner.createTable(
      new Table({
        name: 'auth_refresh_tokens',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'userId', type: 'varchar' },
          { name: 'tokenHash', type: 'varchar', isUnique: true },
          { name: 'familyId', type: 'varchar' },
          { name: 'expiresAt', type: 'datetime' },
          { name: 'revokedAt', type: 'datetime', isNullable: true },
          { name: 'createdByIp', type: 'varchar', isNullable: true },
          { name: 'userAgent', type: 'varchar', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'auth_refresh_tokens',
      new TableIndex({ columnNames: ['userId'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('auth_refresh_tokens');
    await queryRunner.dropTable('auth_user_roles');
    await queryRunner.dropTable('auth_role_permissions');
    await queryRunner.dropTable('auth_permissions');
    await queryRunner.dropTable('auth_roles');
    await queryRunner.dropTable('auth_users');
  }
}
