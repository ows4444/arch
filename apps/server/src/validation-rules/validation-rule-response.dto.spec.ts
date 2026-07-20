import { ValidationRuleResponseDto } from './validation-rule-response.dto';
import { ValidationRuleOperator } from '@/validation';

describe('ValidationRuleResponseDto.fromEntity', () => {
  it('maps every entity field onto the DTO', () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const updatedAt = new Date('2026-01-02T00:00:00Z');

    const dto = ValidationRuleResponseDto.fromEntity({
      id: 1,
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      compareField: 'previousName',
      message: 'Role name "root" is reserved',
      enabled: true,
      createdAt,
      updatedAt,
    });

    expect(dto).toEqual({
      id: 1,
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      compareField: 'previousName',
      message: 'Role name "root" is reserved',
      enabled: true,
      createdAt,
      updatedAt,
    });
  });

  it('normalizes an absent message and compareField to null', () => {
    const dto = ValidationRuleResponseDto.fromEntity({
      id: 1,
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    expect(dto.message).toBeNull();
    expect(dto.compareField).toBeNull();
  });
});
