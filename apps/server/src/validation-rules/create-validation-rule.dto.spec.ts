import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateValidationRuleDto } from './create-validation-rule.dto';
import { ValidationRuleOperator } from '@/validation';

function validate(payload: object) {
  const dto = plainToInstance(CreateValidationRuleDto, payload);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
}

describe('CreateValidationRuleDto', () => {
  it('requires value when compareField is not set', () => {
    const errors = validate({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
    });

    expect(errors.some((error) => error.property === 'value')).toBe(true);
  });

  it('does not require value when compareField is set', () => {
    const errors = validate({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
      compareField: 'endDate',
    });

    expect(errors.some((error) => error.property === 'value')).toBe(false);
  });

  it('still accepts value when compareField is set', () => {
    const errors = validate({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
      compareField: 'endDate',
      value: 0,
    });

    expect(errors).toHaveLength(0);
  });

  it('passes with just value and no compareField', () => {
    const errors = validate({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });

    expect(errors).toHaveLength(0);
  });
});
