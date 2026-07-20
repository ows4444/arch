import { RoleController } from './role.controller';

describe('RoleController', () => {
  function setup() {
    const authorization = {
      createPermission: jest.fn(),
      createRole: jest.fn(),
      listRoles: jest.fn(),
      assignRole: jest.fn().mockResolvedValue(undefined),
      revokeRole: jest.fn().mockResolvedValue(undefined),
      grantPermission: jest.fn(),
      revokePermission: jest.fn(),
    };
    const controller = new RoleController(authorization as never);

    return { controller, authorization };
  }

  it('delegates createPermission to AuthorizationService', async () => {
    const { controller, authorization } = setup();
    authorization.createPermission.mockResolvedValue({
      id: 'perm-1',
      name: 'workflow:read',
    });

    const result = await controller.createPermission({
      name: 'workflow:read',
      description: 'Read workflows',
    });

    expect(authorization.createPermission).toHaveBeenCalledWith(
      'workflow:read',
      'Read workflows',
    );
    expect(result).toEqual({ id: 'perm-1', name: 'workflow:read' });
  });

  it('delegates createRole to AuthorizationService, defaulting permissions to []', async () => {
    const { controller, authorization } = setup();
    authorization.createRole.mockResolvedValue({ id: 'role-1', name: 'admin' });

    await controller.createRole({ name: 'admin' });

    expect(authorization.createRole).toHaveBeenCalledWith('admin', []);
  });

  it('delegates listRoles', async () => {
    const { controller, authorization } = setup();
    authorization.listRoles.mockResolvedValue([{ id: 'role-1' }]);

    await expect(controller.listRoles()).resolves.toEqual([{ id: 'role-1' }]);
  });

  it('delegates grantPermission with the path params', async () => {
    const { controller, authorization } = setup();
    authorization.grantPermission.mockResolvedValue({
      id: 'role-1',
      name: 'admin',
      permissions: [{ id: 'perm-1', name: 'workflow:read' }],
    });

    const result = await controller.grantPermission('admin', 'workflow:read');

    expect(authorization.grantPermission).toHaveBeenCalledWith(
      'admin',
      'workflow:read',
    );
    expect(result).toEqual({
      id: 'role-1',
      name: 'admin',
      permissions: [{ id: 'perm-1', name: 'workflow:read' }],
    });
  });

  it('delegates revokePermission with the path params', async () => {
    const { controller, authorization } = setup();
    authorization.revokePermission.mockResolvedValue({
      id: 'role-1',
      name: 'admin',
      permissions: [],
    });

    const result = await controller.revokePermission('admin', 'workflow:read');

    expect(authorization.revokePermission).toHaveBeenCalledWith(
      'admin',
      'workflow:read',
    );
    expect(result).toEqual({ id: 'role-1', name: 'admin', permissions: [] });
  });

  it('delegates assignRole with the path params', async () => {
    const { controller, authorization } = setup();

    await controller.assignRole('user-1', 'admin');

    expect(authorization.assignRole).toHaveBeenCalledWith('user-1', 'admin');
  });

  it('delegates revokeRole with the path params', async () => {
    const { controller, authorization } = setup();

    await controller.revokeRole('user-1', 'admin');

    expect(authorization.revokeRole).toHaveBeenCalledWith('user-1', 'admin');
  });
});
