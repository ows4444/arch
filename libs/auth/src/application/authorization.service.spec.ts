import { AuthorizationService } from './authorization.service';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';

describe('AuthorizationService', () => {
  function setup() {
    const users = {
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const roles = {
      findByName: jest.fn(),
    };
    const service = new AuthorizationService(users as never, roles as never);

    return { service, users, roles };
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

  describe('assertPermission', () => {
    it('throws InsufficientPermissionsError when the permission is missing', async () => {
      const { service, users } = setup();
      users.findById.mockResolvedValue({ id: 'user-1', roles: [] });

      await expect(
        service.assertPermission('user-1', 'workflow:read'),
      ).rejects.toThrow(InsufficientPermissionsError);
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
  });
});
