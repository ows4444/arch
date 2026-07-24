import { MigrationInterface, QueryRunner, Table } from 'typeorm';

export class InitialUsersSchema1753500000000 implements MigrationInterface {
  name = 'InitialUsersSchema1753500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'user_profiles',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'userId', type: 'varchar', isUnique: true },
          { name: 'displayName', type: 'varchar' },
          { name: 'avatarUrl', type: 'varchar', isNullable: true },
          { name: 'bio', type: 'varchar', isNullable: true },
          { name: 'locale', type: 'varchar', isNullable: true },
          { name: 'timezone', type: 'varchar', isNullable: true },
          { name: 'deactivatedAt', type: 'datetime', isNullable: true },
          {
            name: 'createdAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
          },
          {
            name: 'updatedAt',
            type: 'datetime',
            default: 'CURRENT_TIMESTAMP',
            onUpdate: 'CURRENT_TIMESTAMP',
          },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('user_profiles');
  }
}
