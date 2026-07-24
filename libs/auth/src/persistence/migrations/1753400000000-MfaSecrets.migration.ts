import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Adds `auth_mfa_secrets` — one row per user, `secretCiphertext` holding
 * the AES-256-GCM-encrypted TOTP secret (see `AesGcmMfaSecretCipher`).
 * `enabled: false` rows are enrollments that were started but never
 * confirmed. See `MfaSecretEntity`/`libs/auth/ARCH.md` Design 009.
 */
export class MfaSecrets1753400000000 implements MigrationInterface {
  name = 'MfaSecrets1753400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'auth_mfa_secrets',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'userId', type: 'varchar', isUnique: true },
          { name: 'secretCiphertext', type: 'varchar' },
          { name: 'enabled', type: 'boolean', default: false },
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
    await queryRunner.dropTable('auth_mfa_secrets');
  }
}
