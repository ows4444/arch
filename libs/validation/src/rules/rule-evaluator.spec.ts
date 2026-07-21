import { evaluateStoredRule } from './rule-evaluator';
import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { StoredRule } from './stored-rule.interface';

function rule(overrides: Partial<StoredRule>): StoredRule {
  return {
    id: 1,
    targetType: 'Order',
    field: 'quantity',
    operator: ValidationRuleOperator.EQUALS,
    value: 1,
    compareField: null,
    message: null,
    ...overrides,
  };
}

describe('evaluateStoredRule', () => {
  it('equals / not_equals', () => {
    expect(
      evaluateStoredRule(
        { quantity: 5 },
        rule({ operator: ValidationRuleOperator.EQUALS, value: 5 }),
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule(
        { quantity: 5 },
        rule({ operator: ValidationRuleOperator.NOT_EQUALS, value: 5 }),
      ).satisfied,
    ).toBe(false);
  });

  it('numeric comparisons', () => {
    expect(
      evaluateStoredRule(
        { quantity: 10 },
        rule({ operator: ValidationRuleOperator.GREATER_THAN, value: 5 }),
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule(
        { quantity: 10 },
        rule({
          operator: ValidationRuleOperator.LESS_THAN_OR_EQUAL,
          value: 10,
        }),
      ).satisfied,
    ).toBe(true);
  });

  it('fails closed with a reason when comparing non-numeric operands', () => {
    const result = evaluateStoredRule(
      { quantity: 'ten' },
      rule({ operator: ValidationRuleOperator.GREATER_THAN, value: 5 }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/not a number/);
  });

  it('in / not_in', () => {
    const inRule = rule({
      operator: ValidationRuleOperator.IN,
      value: ['a', 'b'],
      field: 'status',
    });
    expect(evaluateStoredRule({ status: 'a' }, inRule).satisfied).toBe(true);
    expect(evaluateStoredRule({ status: 'z' }, inRule).satisfied).toBe(false);
  });

  it('in fails closed when the stored value is not an array', () => {
    const result = evaluateStoredRule(
      { status: 'a' },
      rule({
        operator: ValidationRuleOperator.IN,
        value: 'not-an-array',
        field: 'status',
      }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/array/);
  });

  it('contains / not_contains on strings and arrays', () => {
    expect(
      evaluateStoredRule(
        { name: 'admin-role' },
        rule({
          operator: ValidationRuleOperator.CONTAINS,
          value: 'admin',
          field: 'name',
        }),
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule(
        { tags: ['x', 'y'] },
        rule({
          operator: ValidationRuleOperator.NOT_CONTAINS,
          value: 'z',
          field: 'tags',
        }),
      ).satisfied,
    ).toBe(true);
  });

  it('contains fails closed on unsupported field types', () => {
    const result = evaluateStoredRule(
      { count: 5 },
      rule({
        operator: ValidationRuleOperator.CONTAINS,
        value: 'x',
        field: 'count',
      }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/string or array/);
  });

  it('compares against another field when compareField is set', () => {
    const spec = rule({
      operator: ValidationRuleOperator.LESS_THAN,
      field: 'startDate',
      compareField: 'endDate',
    });

    expect(
      evaluateStoredRule({ startDate: 1, endDate: 2 }, spec).satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule({ startDate: 5, endDate: 2 }, spec).satisfied,
    ).toBe(false);
  });

  it('cross-field comparison fails closed for non-numeric fields', () => {
    const result = evaluateStoredRule(
      { startDate: 'a', endDate: 2 },
      rule({
        operator: ValidationRuleOperator.LESS_THAN,
        field: 'startDate',
        compareField: 'endDate',
      }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/not a number/);
  });

  it('compareField works with in/not_in — the other field must be an array', () => {
    const inSpec = rule({
      operator: ValidationRuleOperator.IN,
      field: 'status',
      compareField: 'allowedStatuses',
    });

    expect(
      evaluateStoredRule(
        { status: 'active', allowedStatuses: ['active', 'pending'] },
        inSpec,
      ).satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule(
        { status: 'closed', allowedStatuses: ['active', 'pending'] },
        inSpec,
      ).satisfied,
    ).toBe(false);
  });

  it('compareField with in fails closed when the other field is not an array', () => {
    const result = evaluateStoredRule(
      { status: 'active', allowedStatuses: 'active' },
      rule({
        operator: ValidationRuleOperator.IN,
        field: 'status',
        compareField: 'allowedStatuses',
      }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/array/);
  });

  it('fails closed with a reason for an unrecognized operator instead of throwing', () => {
    // Simulates a stored row with an operator outside the enum (e.g. written/edited outside the
    // DTO-validated admin API, or a future enum member the evaluator hasn't been updated for) —
    // the DTO layer normally prevents this, but the evaluator must not crash if it ever happens.
    const result = evaluateStoredRule(
      { quantity: 5 },
      rule({ operator: 'not_a_real_operator' as ValidationRuleOperator }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.reason).toMatch(/unknown operator/);
  });

  it('compareField works with contains/not_contains — the other field becomes the needle', () => {
    const containsSpec = rule({
      operator: ValidationRuleOperator.CONTAINS,
      field: 'tags',
      compareField: 'requiredTag',
    });

    expect(
      evaluateStoredRule({ tags: ['a', 'b'], requiredTag: 'a' }, containsSpec)
        .satisfied,
    ).toBe(true);
    expect(
      evaluateStoredRule({ tags: ['a', 'b'], requiredTag: 'z' }, containsSpec)
        .satisfied,
    ).toBe(false);
  });
});
