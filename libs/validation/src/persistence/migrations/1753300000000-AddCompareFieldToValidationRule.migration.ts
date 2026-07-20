import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCompareFieldToValidationRule1753300000000 implements MigrationInterface {
  name = 'AddCompareFieldToValidationRule1753300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'validation_rule',
      new TableColumn({
        name: 'compareField',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('validation_rule', 'compareField');
  }
}
