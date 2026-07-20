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
      save: jest.fn().mockResolvedValue(undefined),
    };
    const roles = {
      findByName: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
    };
    const permissions = {
      findByName: jest.fn(),
      findByNames: jest.fn().mockResolvedValue([]),
      save: jest.fn(),
    };
    const service = new AuthorizationService(
      users as never,
      roles as never,
      permissions as never,
    );

    return { service, users, roles, permissions };
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
    it('creates a new permission', async () => {
      const { service, permissions } = setup();
      permissions.findByName.mockResolvedValue(null);
      permissions.save.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
        description: null,
      });

      const result = await service.createPermission('workflow:read');

      expect(permissions.save).toHaveBeenCalledWith({
        name: 'workflow:read',
        description: null,
      });
      expect(result.id).toBe('perm-1');
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
    it('creates a role with the requested existing permissions', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue(null);
      permissions.findByNames.mockResolvedValue([
        { id: 'perm-1', name: 'workflow:read' },
      ]);
      roles.save.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });

      const result = await service.createRole('admin', ['workflow:read']);

      expect(roles.save).toHaveBeenCalledWith({
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });
      expect(result.name).toBe('admin');
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
    it('adds a permission the role does not already have', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [],
      });
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });
      roles.save.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });

      await service.grantPermission('admin', 'workflow:read');

      expect(roles.save).toHaveBeenCalledWith({
        id: 'role-1',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });
    });

    it('is a no-op if the role already has the permission', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });

      await service.grantPermission('admin', 'workflow:read');

      expect(roles.save).not.toHaveBeenCalled();
    });

    it('throws for an unknown role', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue(null);

      await expect(
        service.grantPermission('ghost', 'workflow:read'),
      ).rejects.toThrow(RoleNotFoundError);
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
    });
  });

  describe('revokePermission', () => {
    it('removes a permission the role has', async () => {
      const { service, roles, permissions } = setup();
      roles.findByName.mockResolvedValue({
        id: 'role-1',
        name: 'admin',
        permissions: [{ id: 'perm-1', name: 'workflow:read' }],
      });
      permissions.findByName.mockResolvedValue({
        id: 'perm-1',
        name: 'workflow:read',
      });

      await service.revokePermission('admin', 'workflow:read');

      expect(roles.save).toHaveBeenCalledWith({
        id: 'role-1',
        permissions: [],
      });
    });

    it('throws for an unknown role', async () => {
      const { service, roles } = setup();
      roles.findByName.mockResolvedValue(null);

      await expect(
        service.revokePermission('ghost', 'workflow:read'),
      ).rejects.toThrow(RoleNotFoundError);
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
    });
  });

  describe('assignRole', () => {
    it('adds a role the user does not already have', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.assignRole('user-1', 'admin');

      expect(users.save).toHaveBeenCalledWith({
        id: 'user-1',
        roles: [{ id: 'role-1', name: 'admin' }],
      });
    });

    it('is a no-op if the user already has the role', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ id: 'role-1', name: 'admin' }],
      });
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.assignRole('user-1', 'admin');

      expect(users.save).not.toHaveBeenCalled();
    });

    it('throws for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.assignRole('missing', 'admin')).rejects.toThrow(
        UserNotFoundError,
      );
    });

    it('throws for an unknown role', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });
      roles.findByName.mockResolvedValue(null);

      await expect(service.assignRole('user-1', 'ghost')).rejects.toThrow(
        RoleNotFoundError,
      );
    });
  });

  describe('revokeRole', () => {
    it('removes a role the user has', async () => {
      const { service, users, roles } = setup();
      users.findById.mockResolvedValue({
        id: 'user-1',
        roles: [{ id: 'role-1', name: 'admin' }],
      });
      roles.findByName.mockResolvedValue({ id: 'role-1', name: 'admin' });

      await service.revokeRole('user-1', 'admin');

      expect(users.save).toHaveBeenCalledWith({ id: 'user-1', roles: [] });
    });

    it('throws for an unknown user', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue(null);

      await expect(service.revokeRole('missing', 'admin')).rejects.toThrow(
        UserNotFoundError,
      );
    });
  });
});
