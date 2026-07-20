import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class CreateValidationRuleTable1753200000000 implements MigrationInterface {
  name = 'CreateValidationRuleTable1753200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'validation_rule',
        columns: [
          {
            name: 'id',
            type: 'integer',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'targetType', type: 'varchar' },
          { name: 'field', type: 'varchar' },
          { name: 'operator', type: 'varchar' },
          { name: 'value', type: 'json' },
          { name: 'message', type: 'text', isNullable: true },
          { name: 'enabled', type: 'boolean', default: true },
          { name: 'createdAt', type: 'datetime' },
          { name: 'updatedAt', type: 'datetime' },
        ],
      }),
    );

    await queryRunner.createIndex(
      'validation_rule',
      new TableIndex({ columnNames: ['targetType', 'enabled'] }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('validation_rule');
  }
}
