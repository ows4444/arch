import { QueryFailedError } from 'typeorm';
import { UserProfileService } from './user-profile.service';
import { UserProfileNotFoundError } from '../errors/user-profile-not-found.error';
import { ForbiddenProfileAccessError } from '../errors/forbidden-profile-access.error';

describe('UserProfileService', () => {
  function setup(manageOthersPermission?: string) {
    const profiles = {
      findByUserId: jest.fn(),
      save: jest.fn(),
    };
    const authorization = {
      hasPermission: jest.fn(),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new UserProfileService(
      profiles as never,
      authorization as never,
      audit as never,
      manageOthersPermission ? { manageOthersPermission } : {},
    );

    return { service, profiles, authorization, audit };
  }

  describe('getOrCreateMine', () => {
    it('returns the existing profile without writing when one already exists', async () => {
      const { service, profiles } = setup();
      const existing = { userId: 'user-1', displayName: 'Jane' };
      profiles.findByUserId.mockResolvedValue(existing);

      await expect(service.getOrCreateMine('user-1')).resolves.toBe(existing);
      expect(profiles.save).not.toHaveBeenCalled();
    });

    it('creates a default-shaped row when none exists', async () => {
      const { service, profiles } = setup();
      profiles.findByUserId.mockResolvedValue(null);
      const created = { userId: 'user-1', displayName: '' };
      profiles.save.mockResolvedValue(created);

      await expect(service.getOrCreateMine('user-1')).resolves.toBe(created);
      expect(profiles.save).toHaveBeenCalledWith({
        userId: 'user-1',
        displayName: '',
      });
    });

    it('re-reads the row instead of failing when it loses a create race', async () => {
      const { service, profiles } = setup();
      const raceWinner = { userId: 'user-1', displayName: '' };
      profiles.findByUserId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(raceWinner);

      const duplicateError: QueryFailedError = Object.assign(
        Object.create(QueryFailedError.prototype) as QueryFailedError,
        { driverError: { code: 'ER_DUP_ENTRY' } },
      );
      profiles.save.mockRejectedValue(duplicateError);

      await expect(service.getOrCreateMine('user-1')).resolves.toBe(raceWinner);
    });

    it('rethrows a non-duplicate-key write error', async () => {
      const { service, profiles } = setup();
      profiles.findByUserId.mockResolvedValue(null);
      profiles.save.mockRejectedValue(new Error('connection reset'));

      await expect(service.getOrCreateMine('user-1')).rejects.toThrow(
        'connection reset',
      );
    });
  });

  describe('updateMine', () => {
    it('merges the patch onto the (possibly just-created) profile, saves it, and records an audit entry', async () => {
      const { service, profiles, audit } = setup();
      const existing = { userId: 'user-1', displayName: 'Jane' };
      profiles.findByUserId.mockResolvedValue(existing);
      profiles.save.mockImplementation((entity: unknown) =>
        Promise.resolve(entity),
      );

      await expect(
        service.updateMine('user-1', { displayName: 'Jane Doe' }),
      ).resolves.toEqual({ userId: 'user-1', displayName: 'Jane Doe' });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'user-1',
        action: 'profile.updated',
        targetType: 'user_profile',
        targetId: 'user-1',
        metadata: { fields: ['displayName'] },
      });
    });

    it('only lists fields whose value was actually provided, not every key present on the patch object', async () => {
      // Regression test: a real UpdateProfileDto instance (via class-transformer)
      // has every declared field present as an own key set to `undefined` when
      // the caller omits it — confirmed live against real MySQL. A patch object
      // with an explicit `undefined` value reproduces that shape without a full
      // Nest ValidationPipe round trip.
      const { service, profiles, audit } = setup();
      const existing = { userId: 'user-1', displayName: 'Jane' };
      profiles.findByUserId.mockResolvedValue(existing);
      profiles.save.mockImplementation((entity: unknown) =>
        Promise.resolve(entity),
      );

      await service.updateMine('user-1', {
        displayName: 'Jane Doe',
        bio: 'hello',
        avatarUrl: undefined,
        locale: undefined,
        timezone: undefined,
      } as never);

      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { fields: ['displayName', 'bio'] },
        }),
      );
    });
  });

  describe('getForUser', () => {
    it('allows the owner to read their own profile without a permission check', async () => {
      const { service, profiles, authorization } = setup();
      const profile = { userId: 'user-1', displayName: 'Jane' };
      profiles.findByUserId.mockResolvedValue(profile);

      await expect(service.getForUser('user-1', 'user-1')).resolves.toBe(
        profile,
      );
      expect(authorization.hasPermission).not.toHaveBeenCalled();
    });

    it('allows a non-owner holding the manage-others permission', async () => {
      const { service, profiles, authorization } = setup();
      const profile = { userId: 'user-1', displayName: 'Jane' };
      profiles.findByUserId.mockResolvedValue(profile);
      authorization.hasPermission.mockResolvedValue(true);

      await expect(service.getForUser('user-1', 'admin-1')).resolves.toBe(
        profile,
      );
      expect(authorization.hasPermission).toHaveBeenCalledWith(
        'admin-1',
        'users:manage',
      );
    });

    it('rejects a non-owner lacking the permission before ever looking the profile up', async () => {
      const { service, profiles, authorization } = setup();
      authorization.hasPermission.mockResolvedValue(false);

      await expect(
        service.getForUser('user-1', 'stranger-1'),
      ).rejects.toBeInstanceOf(ForbiddenProfileAccessError);
      expect(profiles.findByUserId).not.toHaveBeenCalled();
    });

    it('throws not-found when the owner/permission check passes but no row exists', async () => {
      const { service, profiles } = setup();
      profiles.findByUserId.mockResolvedValue(null);

      await expect(
        service.getForUser('user-1', 'user-1'),
      ).rejects.toBeInstanceOf(UserProfileNotFoundError);
    });

    it('honors a configured manageOthersPermission override', async () => {
      const { service, authorization, profiles } = setup('custom:override');
      profiles.findByUserId.mockResolvedValue({ userId: 'user-1' });
      authorization.hasPermission.mockResolvedValue(true);

      await service.getForUser('user-1', 'admin-1');

      expect(authorization.hasPermission).toHaveBeenCalledWith(
        'admin-1',
        'custom:override',
      );
    });
  });
});
