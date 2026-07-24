import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * Adds `ratelimit_rules`, backing `DatabaseRateLimiterRuleResolver` —
 * admin-editable limiter configs that override the static, code-declared
 * `RateLimitModuleOptions.limiters` map without a redeploy. Only used when
 * `RateLimitModuleOptions.rules?.enabled` is `true`; a deployment that
 * never enables it never queries this table.
 */
export class RateLimitRules1753400000000 implements MigrationInterface {
  name = 'RateLimitRules1753400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'ratelimit_rules',
        columns: [
          { name: 'id', type: 'varchar', isPrimary: true },
          { name: 'name', type: 'varchar', isUnique: true },
          { name: 'limit', type: 'int' },
          { name: 'windowMs', type: 'int' },
          { name: 'algorithm', type: 'varchar', isNullable: true },
          { name: 'updatedAt', type: 'datetime' },
        ],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('ratelimit_rules');
  }
}
