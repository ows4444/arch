import { ValidationRuleController } from './validation-rule.controller';
import { ValidationRuleOperator } from '@/validation';

describe('ValidationRuleController', () => {
  function setup() {
    const admin = {
      create: jest.fn(),
      list: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ValidationRuleController(admin as never);

    return { controller, admin };
  }

  const entity = {
    id: 1,
    targetType: 'Role',
    field: 'name',
    operator: ValidationRuleOperator.NOT_EQUALS,
    value: 'root',
    message: 'Role name "root" is reserved',
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  it('create delegates to ValidationRuleAdminService and maps the response', async () => {
    const { controller, admin } = setup();
    admin.create.mockResolvedValue(entity);

    const dto = {
      targetType: 'Role',
      field: 'name',
      operator: ValidationRuleOperator.NOT_EQUALS,
      value: 'root',
      message: 'Role name "root" is reserved',
    };

    const result = await controller.create(dto);

    expect(admin.create).toHaveBeenCalledWith(dto);
    expect(result).toEqual(
      expect.objectContaining({ id: 1, targetType: 'Role', field: 'name' }),
    );
  });

  it('list delegates the targetType query param and maps every result', async () => {
    const { controller, admin } = setup();
    admin.list.mockResolvedValue([entity]);

    const result = await controller.list('Role');

    expect(admin.list).toHaveBeenCalledWith('Role');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ id: 1 }));
  });

  it('list works without a targetType filter', async () => {
    const { controller, admin } = setup();
    admin.list.mockResolvedValue([]);

    await controller.list();

    expect(admin.list).toHaveBeenCalledWith(undefined);
  });

  it('findOne delegates the id param', async () => {
    const { controller, admin } = setup();
    admin.findOne.mockResolvedValue(entity);

    const result = await controller.findOne(1);

    expect(admin.findOne).toHaveBeenCalledWith(1);
    expect(result.id).toBe(1);
  });

  it('update delegates the id and patch body', async () => {
    const { controller, admin } = setup();
    admin.update.mockResolvedValue({ ...entity, enabled: false });

    const result = await controller.update(1, { enabled: false });

    expect(admin.update).toHaveBeenCalledWith(1, { enabled: false });
    expect(result.enabled).toBe(false);
  });

  it('remove delegates the id param', async () => {
    const { controller, admin } = setup();

    await controller.remove(1);

    expect(admin.remove).toHaveBeenCalledWith(1);
  });
});
