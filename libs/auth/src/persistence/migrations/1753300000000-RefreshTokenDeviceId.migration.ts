import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Adds `deviceId` to `auth_refresh_tokens` — nullable, opaque, client-
 * supplied metadata alongside the existing `createdByIp`/`userAgent`
 * columns (see `RefreshTokenEntity`). Purely additive: existing rows get
 * `NULL`, no behavior depends on this column being populated.
 */
export class RefreshTokenDeviceId1753300000000 implements MigrationInterface {
  name = 'RefreshTokenDeviceId1753300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'auth_refresh_tokens',
      new TableColumn({
        name: 'deviceId',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('auth_refresh_tokens', 'deviceId');
  }
}
