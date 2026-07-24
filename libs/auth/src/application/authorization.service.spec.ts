import { AuthorizationService } from './authorization.service';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';
import { RoleAlreadyExistsError } from '../errors/role-already-exists.error';
import { PermissionAlreadyExistsError } from '../errors/permission-already-exists.error';
import { PermissionNotFoundError } from '../errors/permission-not-found.error';
import { RoleNotFoundError } from '../errors/role-not-found.error';
import { UserNotFoundError } from '../errors/user-not-found.error';

describe('AuthorizationService', () => {
  function setup() {
    const users = {
      findById: jest.fn(),
      addRole: jest.fn().mockResolvedValue(undefined),
      removeRole: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const roles = {
      findByName: jest.fn(),
      addPermission: jest.fn().mockResolvedValue(undefined),
      removePermission: jest.fn().mockResolvedValue(undefined),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const permissions = {
      findByName: jest.fn(),
      findByNames: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new AuthorizationService(
      users as never,
      roles as never,
      permissions as never,
      audit as never,
    );

    return { service, users, roles, permissions, audit };
  }

  describe('hasPermission', () => {
    it('returns true when a granted role carries the permission', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ id: 'role-1', permissions: [{ name: 'workflow:read' }] }],
      });

      await expect(
        service.hasPermission('user-1', 'workflow:read'),
      ).resolves.toBe(true);
    });

    it('returns false when no role carries the permission', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ id: 'role-1', permissions: [{ name: 'workflow:read' }] }],
      });

      await expect(
        service.hasPermission('user-1', 'workflow:write'),
      ).resolves.toBe(false);
    });

    it('returns false for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(
        service.hasPermission('missing', 'workflow:read'),
      ).resolves.toBe(false);
    });
  });

  describe('hasRole', () => {
    it('returns true when the user has the role', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ name: 'admin' }],
      });

      await expect(service.hasRole('user-1', 'admin')).resolves.toBe(true);
    });

    it('returns false when the user lacks the role', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });

      await expect(service.hasRole('user-1', 'admin')).resolves.toBe(false);
    });

    it('returns false for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.hasRole('missing', 'admin')).resolves.toBe(false);
    });
  });

  describe('assertPermission', () => {
    it('throws InsufficientPermissionsError when the permission is missing', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });

      await expect(
        service.assertPermission('user-1', 'workflow:read'),
      ).rejects.toThrow(InsufficientPermissionsError);
    });
  });

  describe('createPermission', () => {
    it('creates a new permission and records an audit entry', async () => {
      const { service, permissions, audit } = setup();
      permissions.findByName.mockResolvedValue(null);
      permissions.save.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
        description: null,
      });

      const result = await service.createPermission(
        'workflow:read',
        undefined,
        'admin-1',
      );

      expect(permissions.save).toHaveBeenCalledWith({
        name: 'workflow:read',
        description: null,
      });
      expect(result.id).toBe('perm-1');
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'permission.created',
        targetType: 'permission',
        targetId: 'workflow:read',
      });
    });

    it('rejects a duplicate permission name', async () => {
      const { service, permissions } = setup();
      permissions.findByName.mockResolvedValue({ id: 'perm-1' });

      await expect(service.createPermission('workflow:read')).rejects.toThrow(
        PermissionAlreadyExistsError,
      );
    });
  });

  describe('createRole', () => {
    it('creates a role with the requested existing permissions and records an audit entry', async () => {
      const { service, roles, permissions, audit } = setup();
      roles.findByName.mockResolvedValue(null);
      permissions.findByNames.mockResolvedValue([
        { id: 'perm-1', name: 'workflow:read' },
      ]);
      roles.save.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });

      const result = await service.createRole(
        'admin',
        ['workflow:read'],
        'admin-1',
      );

      expect(roles.save).toHaveBeenCalledWith({
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });
      expect(result.name).toBe('admin');
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'role.created',
        targetType: 'role',
        targetId: 'admin',
        metadata: { permissions: ['workflow:read'] },
      });
    });

    it('rejects a duplicate role name', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue({ id: 'role-1' });

      await expect(service.createRole('admin')).rejects.toThrow(
        RoleAlreadyExistsError,
      );
    });

    it('rejects a role referencing a permission that does not exist', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue(null);
      permissions.findByNames.mockResolvedValue([]);

      await expect(
        service.createRole('admin', ['workflow:read']),
      ).rejects.toThrow(PermissionNotFoundError);
    });
  });

  describe('grantPermission', () => {
    it('adds a permission the role does not already have and records an audit entry', async () => {
      const { service, roles, permissions, audit } = setup();
      roles.findByName
        .mockResolvedValueOnce({ id: 'role-1', name: 'admin', permissions: [] })
        .mockResolvedValueOnce({
          id: 'role-1',
          name: 'admin',
          permissions: [{ id: 'perm-1', name: 'workflow:read' }],
        });
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });

      const result = await service.grantPermission(
        'admin',
        'workflow:read',
        'admin-1',
      );

      expect(roles.addPermission).toHaveBeenCalledWith('role-1', 'perm-1');
      expect(result.permissions).toEqual([
        { id: 'perm-1', name: 'workflow:read' },
      ]);
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'permission.granted',
        targetType: 'role',
        targetId: 'admin',
        metadata: { permissionName: 'workflow:read' },
      });
    });

    it('throws for an unknown role', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue(null);

      await expect(
        service.grantPermission('ghost', 'workflow:read'),
      ).rejects.toThrow(RoleNotFoundError);
      expect(roles.addPermission).not.toHaveBeenCalled();
    });

    it('throws for an unknown permission', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [],
      });
      permissions.findByName.mockResolvedValue(null);

      await expect(
        service.grantPermission('admin', 'ghost:permission'),
      ).rejects.toThrow(PermissionNotFoundError);
      expect(roles.addPermission).not.toHaveBeenCalled();
    });
  });

  describe('revokePermission', () => {
    it('removes a permission the role has and records an audit entry', async () => {
      const { service, roles, permissions, audit } = setup();
      roles.findByName
        .mockResolvedValueOnce({
          id: 'role-1',
          name: 'admin',
          permissions: [{ id: 'perm-1', name: 'workflow:read' }],
        })
        .mockResolvedValueOnce({
          id: 'role-1',
          name: 'admin',
          permissions: [],
        });
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });

      const result = await service.revokePermission(
        'admin',
        'workflow:read',
        'admin-1',
      );

      expect(roles.removePermission).toHaveBeenCalledWith('role-1', 'perm-1');
      expect(result.permissions).toEqual([]);
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'permission.revoked',
        targetType: 'role',
        targetId: 'admin',
        metadata: { permissionName: 'workflow:read' },
      });
    });

    it('throws for an unknown role', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue(null);

      await expect(
        service.revokePermission('ghost', 'workflow:read'),
      ).rejects.toThrow(RoleNotFoundError);
      expect(roles.removePermission).not.toHaveBeenCalled();
    });

    it('throws for an unknown permission', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [],
      });
      permissions.findByName.mockResolvedValue(null);

      await expect(
        service.revokePermission('admin', 'ghost:permission'),
      ).rejects.toThrow(PermissionNotFoundError);
      expect(roles.removePermission).not.toHaveBeenCalled();
    });
  });

  describe('assignRole', () => {
    it('adds a role to the user via a direct join-table write and records an audit entry', async () => {
      const { service, users, roles, audit } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.assignRole('user-1', 'admin', 'admin-1');

      expect(users.addRole).toHaveBeenCalledWith('user-1', 'role-1');
      expect(users.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'role.assigned',
        targetType: 'user',
        targetId: 'user-1',
        metadata: { roleName: 'admin' },
      });
    });

    it('throws for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.assignRole('missing', 'admin')).rejects.toThrow(
        UserNotFoundError,
      );
      expect(users.addRole).not.toHaveBeenCalled();
    });

    it('throws for an unknown role', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });
      roles.findByName.mockResolvedValue(null);

      await expect(service.assignRole('user-1', 'ghost')).rejects.toThrow(
        RoleNotFoundError,
      );
      expect(users.addRole).not.toHaveBeenCalled();
    });
  });

  describe('listUserRoles', () => {
    it("returns the user's assigned roles", async () => {
      const { service, users } = setup();
      const userRoles = [{ id: 'role-1', name: 'admin' }];
      users.findById.mockResolvedValue({ id: 'user-1', roles: userRoles });

      await expect(service.listUserRoles('user-1')).resolves.toBe(userRoles);
    });

    it('throws for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.listUserRoles('missing')).rejects.toThrow(
        UserNotFoundError,
      );
    });
  });

  describe('deleteRole', () => {
    it('deletes an existing role and records an audit entry', async () => {
      const { service, roles, audit } = setup();
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.deleteRole('admin', 'admin-1');

      expect(roles.delete).toHaveBeenCalledWith({ id: 'role-1' });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'role.deleted',
        targetType: 'role',
        targetId: 'admin',
      });
    });

    it('throws for an unknown role', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue(null);

      await expect(service.deleteRole('ghost')).rejects.toThrow(
        RoleNotFoundError,
      );
      expect(roles.delete).not.toHaveBeenCalled();
    });
  });

  describe('deletePermission', () => {
    it('deletes an existing permission and records an audit entry', async () => {
      const { service, permissions, audit } = setup();
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });

      await service.deletePermission('workflow:read', 'admin-1');

      expect(permissions.delete).toHaveBeenCalledWith({ id: 'perm-1' });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'permission.deleted',
        targetType: 'permission',
        targetId: 'workflow:read',
      });
    });

    it('throws for an unknown permission', async () => {
      const { service, permissions } = setup();
      permissions.findByName.mockResolvedValue(null);

      await expect(
        service.deletePermission('ghost:permission'),
      ).rejects.toThrow(PermissionNotFoundError);
      expect(permissions.delete).not.toHaveBeenCalled();
    });
  });

  describe('revokeRole', () => {
    it('removes a role from the user via a direct join-table write and records an audit entry', async () => {
      const { service, users, roles, audit } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ id: 'role-1', name: 'admin' }],
      });
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.revokeRole('user-1', 'admin', 'admin-1');

      expect(users.removeRole).toHaveBeenCalledWith('user-1', 'role-1');
      expect(users.save).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'role.revoked',
        targetType: 'user',
        targetId: 'user-1',
        metadata: { roleName: 'admin' },
      });
    });

    it('throws for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.revokeRole('missing', 'admin')).rejects.toThrow(
        UserNotFoundError,
      );
      expect(users.removeRole).not.toHaveBeenCalled();
    });
  });
});
