import { QueryFailedError } from 'typeorm';
import { MembershipService } from './membership.service';
import { MembershipRole } from '../domain/membership-role.enum';
import { MembershipNotFoundError } from '../errors/membership-not-found.error';
import { AlreadyAMemberError } from '../errors/already-a-member.error';
import { CannotRemoveLastOwnerError } from '../errors/cannot-remove-last-owner.error';
import { ForbiddenOrganizationAccessError } from '../errors/forbidden-organization-access.error';

describe('MembershipService', () => {
  function setup() {
    const memberships = {
      save: jest.fn(),
      delete: jest.fn(),
      findByOrganizationAndUser: jest.fn(),
      findByOrganization: jest.fn(),
      countByOrganizationAndRole: jest.fn(),
    };
    const organizations = {
      assertOrgRole: jest.fn().mockResolvedValue(undefined),
      hasManageOverride: jest.fn().mockResolvedValue(false),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new MembershipService(
      memberships as never,
      organizations as never,
      audit as never,
    );

    return { service, memberships, organizations, audit };
  }

  describe('listMembers', () => {
    it('requires at least member-level access and returns the roster', async () => {
      const { service, memberships, organizations } = setup();
      const roster = [{ userId: 'user-1', role: MembershipRole.OWNER }];
      memberships.findByOrganization.mockResolvedValue(roster);

      await expect(service.listMembers('org-1', 'user-1')).resolves.toBe(
        roster,
      );
      expect(organizations.assertOrgRole).toHaveBeenCalledWith(
        'user-1',
        'org-1',
        MembershipRole.MEMBER,
      );
    });
  });

  describe('addMember', () => {
    it('requires admin-level access and adds the member, recording an audit entry', async () => {
      const { service, memberships, organizations, audit } = setup();
      const created = {
        organizationId: 'org-1',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
      };
      memberships.save.mockResolvedValue(created);

      await expect(
        service.addMember('org-1', 'user-2', MembershipRole.MEMBER, 'admin-1'),
      ).resolves.toBe(created);

      expect(organizations.assertOrgRole).toHaveBeenCalledWith(
        'admin-1',
        'org-1',
        MembershipRole.ADMIN,
      );
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'admin-1',
        action: 'membership.added',
        targetType: 'organization',
        targetId: 'org-1',
        metadata: { userId: 'user-2', role: MembershipRole.MEMBER },
      });
    });

    it('translates a unique-constraint violation into AlreadyAMemberError', async () => {
      const { service, memberships } = setup();
      const duplicateError: QueryFailedError = Object.assign(
        Object.create(QueryFailedError.prototype) as QueryFailedError,
        { driverError: { code: 'ER_DUP_ENTRY' } },
      );
      memberships.save.mockRejectedValue(duplicateError);

      await expect(
        service.addMember('org-1', 'user-2', MembershipRole.MEMBER, 'admin-1'),
      ).rejects.toBeInstanceOf(AlreadyAMemberError);
    });

    it('rejects an admin trying to add a new owner without being one themselves', async () => {
      const { service, memberships, organizations } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.ADMIN,
      });
      organizations.hasManageOverride.mockResolvedValue(false);

      await expect(
        service.addMember('org-1', 'user-2', MembershipRole.OWNER, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
      expect(memberships.save).not.toHaveBeenCalled();
    });

    it('allows an owner to add a new owner', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.OWNER,
      });
      memberships.save.mockResolvedValue({
        organizationId: 'org-1',
        userId: 'user-2',
        role: MembershipRole.OWNER,
      });

      await expect(
        service.addMember('org-1', 'user-2', MembershipRole.OWNER, 'owner-1'),
      ).resolves.toMatchObject({ role: MembershipRole.OWNER });
    });
  });

  describe('changeRole', () => {
    it('lets an admin change a member’s role', async () => {
      const { service, memberships, audit } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
      });
      memberships.save.mockImplementation((entity: unknown) =>
        Promise.resolve(entity),
      );

      const updated = await service.changeRole(
        'org-1',
        'user-2',
        MembershipRole.ADMIN,
        'admin-1',
      );

      expect(updated).toMatchObject({ role: MembershipRole.ADMIN });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'membership.role_changed' }),
      );
    });

    it('throws MembershipNotFoundError when the target has no membership', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue(null);

      await expect(
        service.changeRole('org-1', 'user-2', MembershipRole.ADMIN, 'admin-1'),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
    });

    it('rejects an admin trying to change an owner’s role', async () => {
      const { service, memberships, organizations } = setup();
      memberships.findByOrganizationAndUser
        .mockResolvedValueOnce({
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'owner-2',
          role: MembershipRole.OWNER,
        })
        .mockResolvedValueOnce({ role: MembershipRole.ADMIN }); // acting user's own membership
      organizations.hasManageOverride.mockResolvedValue(false);

      await expect(
        service.changeRole('org-1', 'owner-2', MembershipRole.ADMIN, 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
      expect(memberships.save).not.toHaveBeenCalled();
    });

    it('lets an owner demote another owner as long as one owner remains', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser
        .mockResolvedValueOnce({
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'owner-2',
          role: MembershipRole.OWNER,
        })
        .mockResolvedValueOnce({ role: MembershipRole.OWNER }); // acting user's own membership
      memberships.countByOrganizationAndRole.mockResolvedValue(2);
      memberships.save.mockImplementation((entity: unknown) =>
        Promise.resolve(entity),
      );

      await expect(
        service.changeRole('org-1', 'owner-2', MembershipRole.ADMIN, 'owner-1'),
      ).resolves.toMatchObject({ role: MembershipRole.ADMIN });
    });

    it('blocks demoting the last remaining owner', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser
        .mockResolvedValueOnce({
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'owner-1',
          role: MembershipRole.OWNER,
        })
        .mockResolvedValueOnce({ role: MembershipRole.OWNER });
      memberships.countByOrganizationAndRole.mockResolvedValue(1);

      await expect(
        service.changeRole('org-1', 'owner-1', MembershipRole.ADMIN, 'owner-1'),
      ).rejects.toBeInstanceOf(CannotRemoveLastOwnerError);
      expect(memberships.save).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('lets a member remove themselves without the admin gate', async () => {
      const { service, memberships, organizations, audit } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-1',
        role: MembershipRole.MEMBER,
      });

      await service.removeMember('org-1', 'user-1', 'user-1');

      expect(organizations.assertOrgRole).not.toHaveBeenCalled();
      expect(memberships.delete).toHaveBeenCalledWith({ id: 'm-1' });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'membership.removed' }),
      );
    });

    it('requires admin-level access to remove someone else', async () => {
      const { service, memberships, organizations } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        id: 'm-1',
        organizationId: 'org-1',
        userId: 'user-2',
        role: MembershipRole.MEMBER,
      });

      await service.removeMember('org-1', 'user-2', 'admin-1');

      expect(organizations.assertOrgRole).toHaveBeenCalledWith(
        'admin-1',
        'org-1',
        MembershipRole.ADMIN,
      );
    });

    it('throws MembershipNotFoundError for a non-member target', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue(null);

      await expect(
        service.removeMember('org-1', 'user-2', 'admin-1'),
      ).rejects.toBeInstanceOf(MembershipNotFoundError);
    });

    it('rejects an unauthorized caller before ever looking the target membership up, so a nonexistent target does not leak as 404 instead of 403', async () => {
      // Regression test for a Loop 003 review finding: an earlier version of
      // removeMember looked the target up before checking assertOrgRole,
      // so an unauthorized (non-admin, non-member) caller could tell
      // "target is a member" (403) apart from "target isn't a member" (404)
      // by response code alone.
      const { service, memberships, organizations } = setup();
      organizations.assertOrgRole.mockRejectedValue(
        new ForbiddenOrganizationAccessError(),
      );

      await expect(
        service.removeMember('org-1', 'nonexistent-user', 'stranger-1'),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
      expect(memberships.findByOrganizationAndUser).not.toHaveBeenCalled();
    });

    it('rejects an admin removing an owner', async () => {
      const { service, memberships, organizations } = setup();
      memberships.findByOrganizationAndUser
        .mockResolvedValueOnce({
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'owner-1',
          role: MembershipRole.OWNER,
        })
        .mockResolvedValueOnce({ role: MembershipRole.ADMIN });
      organizations.hasManageOverride.mockResolvedValue(false);

      await expect(
        service.removeMember('org-1', 'owner-1', 'admin-1'),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
      expect(memberships.delete).not.toHaveBeenCalled();
    });

    it('blocks removing the last remaining owner even by another owner', async () => {
      const { service, memberships } = setup();
      memberships.findByOrganizationAndUser
        .mockResolvedValueOnce({
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'owner-1',
          role: MembershipRole.OWNER,
        })
        .mockResolvedValueOnce({ role: MembershipRole.OWNER });
      memberships.countByOrganizationAndRole.mockResolvedValue(1);

      await expect(
        service.removeMember('org-1', 'owner-1', 'owner-2'),
      ).rejects.toBeInstanceOf(CannotRemoveLastOwnerError);
      expect(memberships.delete).not.toHaveBeenCalled();
    });
  });
});
