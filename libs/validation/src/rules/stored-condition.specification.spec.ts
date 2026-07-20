import { composeStoredRules } from './stored-condition.specification';
import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { StoredRule } from './stored-rule.interface';

describe('composeStoredRules', () => {
  it('is satisfied trivially when there are no rules', async () => {
    const specification = composeStoredRules([]);
    expect(await specification.isSatisfiedBy({})).toBe(true);
    expect(await specification.explain({})).toEqual([]);
  });

  it('is satisfied only when every rule passes', async () => {
    const rules: StoredRule[] = [
      {
        id: 1,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_EQUALS,
        value: 'root',
        compareField: null,
        message: 'Role name "root" is reserved',
      },
      {
        id: 2,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_CONTAINS,
        value: 'admin',
        compareField: null,
        message: null,
      },
    ];
    const specification = composeStoredRules(rules);

    expect(await specification.isSatisfiedBy({ name: 'viewer' })).toBe(true);
    expect(await specification.isSatisfiedBy({ name: 'root' })).toBe(false);
  });

  it('collects a custom message when set, otherwise a default message', async () => {
    const rules: StoredRule[] = [
      {
        id: 1,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_EQUALS,
        value: 'root',
        compareField: null,
        message: 'Role name "root" is reserved',
      },
      {
        id: 2,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_CONTAINS,
        value: 'admin',
        compareField: null,
        message: null,
      },
    ];
    const specification = composeStoredRules(rules);

    const failures = await specification.explain({ name: 'root-admin' });
    expect(failures).toEqual(['name failed rule "not_contains"']);
  });
});
