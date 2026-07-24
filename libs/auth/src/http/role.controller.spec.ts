import { RoleController } from './role.controller';
import type { AuthenticatedUser } from '../guards/jwt-auth.guard';

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
      deleteRole: jest.fn().mockResolvedValue(undefined),
      deletePermission: jest.fn().mockResolvedValue(undefined),
      listUserRoles: jest.fn(),
    };
    const controller = new RoleController(authorization as never);

    return { controller, authorization };
  }

  const actor = { userId: 'admin-1' } as AuthenticatedUser;

  it('delegates createPermission to AuthorizationService, forwarding the acting user', async () => {
    const { controller, authorization } = setup();
    authorization.createPermission.mockResolvedValue({
      id: 'perm-1',
      name: 'workflow:read',
    });

    const result = await controller.createPermission(
      { name: 'workflow:read', description: 'Read workflows' },
      actor,
    );

    expect(authorization.createPermission).toHaveBeenCalledWith(
      'workflow:read',
      'Read workflows',
      'admin-1',
    );
    expect(result).toEqual({ id: 'perm-1', name: 'workflow:read' });
  });

  it('delegates createRole to AuthorizationService, defaulting permissions to [] and forwarding the acting user', async () => {
    const { controller, authorization } = setup();
    authorization.createRole.mockResolvedValue({ id: 'role-1', name: 'admin' });

    await controller.createRole({ name: 'admin' }, actor);

    expect(authorization.createRole).toHaveBeenCalledWith(
      'admin',
      [],
      'admin-1',
    );
  });

  it('delegates listRoles', async () => {
    const { controller, authorization } = setup();
    authorization.listRoles.mockResolvedValue([{ id: 'role-1' }]);

    await expect(controller.listRoles()).resolves.toEqual([{ id: 'role-1' }]);
  });

  it('delegates grantPermission with the path params and the acting user', async () => {
    const { controller, authorization } = setup();
    authorization.grantPermission.mockResolvedValue({
      id: 'role-1',
      name: 'admin',
      permissions: [{ id: 'perm-1', name: 'workflow:read' }],
    });

    const result = await controller.grantPermission(
      'admin',
      'workflow:read',
      actor,
    );

    expect(authorization.grantPermission).toHaveBeenCalledWith(
      'admin',
      'workflow:read',
      'admin-1',
    );
    expect(result).toEqual({
      id: 'role-1',
      name: 'admin',
      permissions: [{ id: 'perm-1', name: 'workflow:read' }],
    });
  });

  it('delegates revokePermission with the path params and the acting user', async () => {
    const { controller, authorization } = setup();
    authorization.revokePermission.mockResolvedValue({
      id: 'role-1',
      name: 'admin',
      permissions: [],
    });

    const result = await controller.revokePermission(
      'admin',
      'workflow:read',
      actor,
    );

    expect(authorization.revokePermission).toHaveBeenCalledWith(
      'admin',
      'workflow:read',
      'admin-1',
    );
    expect(result).toEqual({ id: 'role-1', name: 'admin', permissions: [] });
  });

  it('delegates assignRole with the path params and the acting user', async () => {
    const { controller, authorization } = setup();

    await controller.assignRole('user-1', 'admin', actor);

    expect(authorization.assignRole).toHaveBeenCalledWith(
      'user-1',
      'admin',
      'admin-1',
    );
  });

  it('delegates revokeRole with the path params and the acting user', async () => {
    const { controller, authorization } = setup();

    await controller.revokeRole('user-1', 'admin', actor);

    expect(authorization.revokeRole).toHaveBeenCalledWith(
      'user-1',
      'admin',
      'admin-1',
    );
  });

  it('delegates deleteRole with the path param and the acting user', async () => {
    const { controller, authorization } = setup();

    await controller.deleteRole('admin', actor);

    expect(authorization.deleteRole).toHaveBeenCalledWith('admin', 'admin-1');
  });

  it('delegates deletePermission with the path param and the acting user', async () => {
    const { controller, authorization } = setup();

    await controller.deletePermission('workflow:read', actor);

    expect(authorization.deletePermission).toHaveBeenCalledWith(
      'workflow:read',
      'admin-1',
    );
  });

  it('delegates listUserRoles with the path param', async () => {
    const { controller, authorization } = setup();
    authorization.listUserRoles.mockResolvedValue([{ id: 'role-1' }]);

    await expect(controller.listUserRoles('user-1')).resolves.toEqual([
      { id: 'role-1' },
    ]);
    expect(authorization.listUserRoles).toHaveBeenCalledWith('user-1');
  });
});
