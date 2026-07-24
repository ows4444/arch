import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

/**
 * Adds `auth_tokens`, the single-use hashed-token table backing both
 * password reset and email verification (`AuthTokenEntity.purpose`
 * distinguishes the two) — see `AuthTokenEntity` for why one table serves
 * both rather than duplicating the schema.
 */
export class AuthTokens1753200000000 implements MigrationInterface {
  name = 'AuthTokens1753200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'auth_tokens',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'userId', type: 'varchar' },
          { name: 'purpose', type: 'varchar' },
          { name: 'tokenHash', type: 'varchar', isUnique: true },
          { name: 'expiresAt', type: 'datetime' },
          { name: 'usedAt', type: 'datetime', isNullable: true },
          { name: 'createdAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'auth_tokens',
      new TableIndex({ columnNames: ['userId', 'purpose'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('auth_tokens');
  }
}
