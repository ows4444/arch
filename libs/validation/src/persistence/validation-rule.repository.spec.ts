import { DataSource } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import { DatabaseRole } from '@/database';
import { ValidationRuleRepository } from './validation-rule.repository';
import { ValidationRuleOperator } from '../rules/validation-rule-operator.enum';
import {
  createValidationTestDataSource,
  fakeRepositoryResolver,
} from '../testing/validation-test-datasource';

describe('ValidationRuleRepository', () => {
  let dataSource: DataSource;
  let repository: ValidationRuleRepository;

  beforeEach(async () => {
    dataSource = await createValidationTestDataSource();
    repository = new ValidationRuleRepository(
      DatabaseRole.WRITE,
      fakeRepositoryResolver(dataSource),
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('creates a rule and finds it by id', async () => {
    const created = await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      message: 'Role name "root" is reserved',
    });

    expect(created.id).toBeDefined();
    expect(created.enabled).toBe(true);

    const found = await repository.findById(created.id);
    expect(found?.field).toBe('name');
  });

  it('findEnabledByTargetType only returns enabled rules for that target type', async () => {
    await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });
    await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_CONTAINS,
      value: 'admin',
      enabled: false,
    });
    await repository.createRule({
      targetType: 'Order',
      field: 'quantity',
      operator: ValidationRuleOperator.GREATER_THAN,
      value: 0,
    });

    const rules = await repository.findEnabledByTargetType('Role');
    expect(rules).toHaveLength(1);
    expect(rules[0]?.value).toBe('root');
  });

  it('updateRule updates fields and returns null for an unknown id', async () => {
    const created = await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });

    const updated = await repository.updateRule(created.id, {
      enabled: false,
    });
    expect(updated?.enabled).toBe(false);

    const missing = await repository.updateRule(999_999, { enabled: false });
    expect(missing).toBeNull();
  });

  it('deleteRule removes the row and reports whether anything was deleted', async () => {
    const created = await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });

    expect(await repository.deleteRule(created.id)).toBe(true);
    expect(await repository.findById(created.id)).toBeNull();
    expect(await repository.deleteRule(created.id)).toBe(false);
  });

  it('findAll filters by target type when provided', async () => {
    await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });
    await repository.createRule({
      targetType: 'Order',
      field: 'quantity',
      operator: ValidationRuleOperator.GREATER_THAN,
      value: 0,
    });

    expect(await repository.findAll()).toHaveLength(2);
    expect(await repository.findAll('Order')).toHaveLength(1);
  });

  it('persists compareField, defaulting to null when omitted', async () => {
    const withoutCompareField = await repository.createRule({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
      value: 0,
    });
    expect(withoutCompareField.compareField).toBeNull();

    const withCompareField = await repository.createRule({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
      value: 0,
      compareField: 'endDate',
    });
    expect(withCompareField.compareField).toBe('endDate');

    const updated = await repository.updateRule(withoutCompareField.id, {
      compareField: 'endDate',
    });
    expect(updated?.compareField).toBe('endDate');
  });

  it('updateRule does not clobber untouched fields when the patch is a class-transformer DTO instance', async () => {
    // Regression test: a class-transformer-constructed DTO (as arrives over real HTTP requests,
    // via `plainToInstance` inside Nest's ValidationPipe) has every declared optional field
    // present as an explicit own `undefined` property (TS class-field "define" semantics) — a
    // plain object literal like `{ enabled: false }` in other tests does not reproduce this.
    class UpdatePatchDto {
      field?: string;
      operator?: ValidationRuleOperator;
      value?: unknown;
      compareField?: string;
      message?: string;
      enabled?: boolean;
    }

    const created = await repository.createRule({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      message: 'custom message',
    });

    const patch = plainToInstance(UpdatePatchDto, { enabled: false });
    expect(Object.keys(patch)).toContain('field'); // sanity: reproduces the "define" semantics

    const updated = await repository.updateRule(created.id, patch);

    expect(updated?.enabled).toBe(false);
    expect(updated?.field).toBe('name');
    expect(updated?.operator).toBe(ValidationRuleOperator.NOT_EQUALS);
    expect(updated?.value).toBe('root');
    expect(updated?.message).toBe('custom message');
  });

  it('createRule defaults value to null when omitted (cross-field rules do not need it)', async () => {
    const created = await repository.createRule({
      targetType: 'Order',
      field: 'startDate',
      operator: ValidationRuleOperator.LESS_THAN,
      compareField: 'endDate',
    });

    expect(created.value).toBeNull();
    expect(created.compareField).toBe('endDate');
  });
});
