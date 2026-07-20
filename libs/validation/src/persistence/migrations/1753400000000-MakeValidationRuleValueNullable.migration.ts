import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class MakeValidationRuleValueNullable1753400000000 implements MigrationInterface {
  name = 'MakeValidationRuleValueNullable1753400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'validation_rule',
      'value',
      new TableColumn({ name: 'value', type: 'json', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.changeColumn(
      'validation_rule',
      'value',
      new TableColumn({ name: 'value', type: 'json', isNullable: false }),
    );
  }
}
