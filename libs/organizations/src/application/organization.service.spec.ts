import { OrganizationService } from './organization.service';
import { MembershipRole } from '../domain/membership-role.enum';
import { OrganizationNotFoundError } from '../errors/organization-not-found.error';
import { ForbiddenOrganizationAccessError } from '../errors/forbidden-organization-access.error';

describe('OrganizationService', () => {
  function setup(manageOrganizationsPermission?: string) {
    const organizations = {
      save: jest.fn(),
      findOneBy: jest.fn(),
      delete: jest.fn(),
    };
    const memberships = {
      save: jest.fn(),
      findByOrganizationAndUser: jest.fn(),
    };
    const authorization = {
      hasPermission: jest.fn(),
    };
    const audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrganizationService(
      organizations as never,
      memberships as never,
      authorization as never,
      audit as never,
      manageOrganizationsPermission ? { manageOrganizationsPermission } : {},
    );

    return { service, organizations, memberships, authorization, audit };
  }

  describe('create', () => {
    it('creates the organization and an owner membership for the given user, and records an audit entry', async () => {
      const { service, organizations, memberships, audit } = setup();
      const organization = { id: 'org-1', name: 'Acme' };
      organizations.save.mockResolvedValue(organization);
      memberships.save.mockResolvedValue({
        organizationId: 'org-1',
        userId: 'user-1',
        role: MembershipRole.OWNER,
      });

      await expect(service.create('Acme', 'user-1')).resolves.toBe(
        organization,
      );

      expect(organizations.save).toHaveBeenCalledWith({ name: 'Acme' });
      expect(memberships.save).toHaveBeenCalledWith({
        organizationId: 'org-1',
        userId: 'user-1',
        role: MembershipRole.OWNER,
      });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'user-1',
        action: 'organization.created',
        targetType: 'organization',
        targetId: 'org-1',
        metadata: { name: 'Acme' },
      });
    });
  });

  describe('assertOrgRole', () => {
    it('allows a member whose role satisfies the required minimum', async () => {
      const { service, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.ADMIN,
      });

      await expect(
        service.assertOrgRole('user-1', 'org-1', MembershipRole.MEMBER),
      ).resolves.toBeUndefined();
      expect(authorization.hasPermission).not.toHaveBeenCalled();
    });

    it('rejects a member whose role is below the required minimum and lacks the override', async () => {
      const { service, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.MEMBER,
      });
      authorization.hasPermission.mockResolvedValue(false);

      await expect(
        service.assertOrgRole('user-1', 'org-1', MembershipRole.ADMIN),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
    });

    it('allows a non-member holding the platform override permission', async () => {
      const { service, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue(null);
      authorization.hasPermission.mockResolvedValue(true);

      await expect(
        service.assertOrgRole('admin-1', 'org-1', MembershipRole.OWNER),
      ).resolves.toBeUndefined();
      expect(authorization.hasPermission).toHaveBeenCalledWith(
        'admin-1',
        'organizations:manage',
      );
    });

    it('rejects a non-member lacking the override', async () => {
      const { service, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue(null);
      authorization.hasPermission.mockResolvedValue(false);

      await expect(
        service.assertOrgRole('stranger-1', 'org-1', MembershipRole.MEMBER),
      ).rejects.toBeInstanceOf(ForbiddenOrganizationAccessError);
    });

    it('honors a configured manageOrganizationsPermission override', async () => {
      const { service, memberships, authorization } = setup('custom:override');
      memberships.findByOrganizationAndUser.mockResolvedValue(null);
      authorization.hasPermission.mockResolvedValue(true);

      await service.assertOrgRole('admin-1', 'org-1', MembershipRole.OWNER);

      expect(authorization.hasPermission).toHaveBeenCalledWith(
        'admin-1',
        'custom:override',
      );
    });
  });

  describe('get', () => {
    it('returns the organization once assertOrgRole passes', async () => {
      const { service, organizations, memberships } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.MEMBER,
      });
      const organization = { id: 'org-1', name: 'Acme' };
      organizations.findOneBy.mockResolvedValue(organization);

      await expect(service.get('org-1', 'user-1')).resolves.toBe(organization);
    });

    it('throws not-found when membership passes but the row is gone', async () => {
      const { service, organizations, memberships } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.MEMBER,
      });
      organizations.findOneBy.mockResolvedValue(null);

      await expect(service.get('org-1', 'user-1')).rejects.toBeInstanceOf(
        OrganizationNotFoundError,
      );
    });

    it('rejects before looking the organization up when the caller has no access', async () => {
      const { service, organizations, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue(null);
      authorization.hasPermission.mockResolvedValue(false);

      await expect(service.get('org-1', 'stranger-1')).rejects.toBeInstanceOf(
        ForbiddenOrganizationAccessError,
      );
      expect(organizations.findOneBy).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('requires the owner role and deletes the organization, recording an audit entry', async () => {
      const { service, organizations, memberships, audit } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.OWNER,
      });
      organizations.findOneBy.mockResolvedValue({ id: 'org-1', name: 'Acme' });

      await service.delete('org-1', 'user-1');

      expect(organizations.delete).toHaveBeenCalledWith({ id: 'org-1' });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: 'user-1',
        action: 'organization.deleted',
        targetType: 'organization',
        targetId: 'org-1',
      });
    });

    it('rejects an admin (below owner) without the override', async () => {
      const { service, organizations, memberships, authorization } = setup();
      memberships.findByOrganizationAndUser.mockResolvedValue({
        role: MembershipRole.ADMIN,
      });
      authorization.hasPermission.mockResolvedValue(false);

      await expect(service.delete('org-1', 'user-1')).rejects.toBeInstanceOf(
        ForbiddenOrganizationAccessError,
      );
      expect(organizations.delete).not.toHaveBeenCalled();
    });
  });
});
