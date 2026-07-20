import { DataSource } from 'typeorm';
import { DatabaseRole } from '@/database';
import { ValidationRuleAdminService } from './validation-rule-admin.service';
import { ValidationRuleNotFoundError } from '../errors/validation-rule-not-found.error';
import { ValidationRuleRepository } from '../persistence/validation-rule.repository';
import { ValidationRuleOperator } from './validation-rule-operator.enum';
import type { ValidationRuleStore } from './validation-rule-store.interface';
import {
  createValidationTestDataSource,
  fakeRepositoryResolver,
} from '../testing/validation-test-datasource';

describe('ValidationRuleAdminService', () => {
  let dataSource: DataSource;
  let service: ValidationRuleAdminService;
  let store: ValidationRuleStore;

  beforeEach(async () => {
    dataSource = await createValidationTestDataSource();
    const repository = new ValidationRuleRepository(
      DatabaseRole.WRITE,
      fakeRepositoryResolver(dataSource),
    );
    store = {
      findRules: jest.fn(() => Promise.resolve([])),
      invalidate: jest.fn(() => Promise.resolve()),
    };
    service = new ValidationRuleAdminService(repository, store);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('creates and lists rules, invalidating the store for that target type', async () => {
    const created = await service.create({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });

    const rules = await service.list('Role');
    expect(rules).toHaveLength(1);
    expect(store.invalidate).toHaveBeenCalledWith('Role');
    expect(created.targetType).toBe('Role');
  });

  it('findOne throws ValidationRuleNotFoundError for an unknown id', async () => {
    await expect(service.findOne(999_999)).rejects.toBeInstanceOf(
      ValidationRuleNotFoundError,
    );
  });

  it('update mutates an existing rule and invalidates the store', async () => {
    const created = await service.create({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });
    (store.invalidate as jest.Mock).mockClear();

    const updated = await service.update(created.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(store.invalidate).toHaveBeenCalledWith('Role');
  });

  it('update throws ValidationRuleNotFoundError for an unknown id', async () => {
    await expect(
      service.update(999_999, { enabled: false }),
    ).rejects.toBeInstanceOf(ValidationRuleNotFoundError);
  });

  it('remove deletes an existing rule, invalidates the store, and throws for an unknown id', async () => {
    const created = await service.create({
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
    });
    (store.invalidate as jest.Mock).mockClear();

    await service.remove(created.id);
    expect(store.invalidate).toHaveBeenCalledWith('Role');

    await expect(service.findOne(created.id)).rejects.toBeInstanceOf(
      ValidationRuleNotFoundError,
    );
    await expect(service.remove(created.id)).rejects.toBeInstanceOf(
      ValidationRuleNotFoundError,
    );
  });
});
