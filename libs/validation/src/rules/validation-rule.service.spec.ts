import { ValidationRuleService } from './validation-rule.service';
import { ValidationService } from '../nest/validation.service';
import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { StoredRule } from './stored-rule.interface';
import type { ValidationRuleStore } from './validation-rule-store.interface';

function fakeStore(rules: StoredRule[]): ValidationRuleStore {
  return {
    findRules: () => Promise.resolve(rules),
    invalidate: () => Promise.resolve(),
  };
}

describe('ValidationRuleService', () => {
  it('is valid when the store returns no rules for the target type', async () => {
    const service = new ValidationRuleService(
      fakeStore([]),
      new ValidationService(),
    );
    const result = await service.validateStored('Role', { name: 'anything' });
    expect(result.isValid).toBe(true);
  });

  it('validates a candidate against the rules returned for its target type', async () => {
    const store = fakeStore([
      {
        id: 1,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_EQUALS,
        value: 'root',
        compareField: null,
        message: 'Role name "root" is reserved',
      },
    ]);
    const service = new ValidationRuleService(store, new ValidationService());

    const passing = await service.validateStored('Role', { name: 'viewer' });
    expect(passing.isValid).toBe(true);

    const failing = await service.validateStored('Role', { name: 'root' });
    expect(failing.isValid).toBe(false);
    expect(failing.messages).toEqual(['Role name "root" is reserved']);
  });

  it('validateStoredOrThrow throws when a stored rule fails', async () => {
    const store = fakeStore([
      {
        id: 1,
        targetType: 'Role',
        field: 'name',
        operator: ValidationRuleOperator.NOT_EQUALS,
        value: 'root',
        compareField: null,
        message: 'Role name "root" is reserved',
      },
    ]);
    const service = new ValidationRuleService(store, new ValidationService());

    await expect(
      service.validateStoredOrThrow('Role', { name: 'root' }),
    ).rejects.toThrow();
    await expect(
      service.validateStoredOrThrow('Role', { name: 'viewer' }),
    ).resolves.toBeUndefined();
  });
});
