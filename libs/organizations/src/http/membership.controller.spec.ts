import { MembershipController } from './membership.controller';
import { MembershipRole } from '../domain/membership-role.enum';
import type { AuthenticatedUser } from '@/auth';

describe('MembershipController', () => {
  function setup() {
    const memberships = {
      listMembers: jest.fn(),
      addMember: jest.fn(),
      changeRole: jest.fn(),
      removeMember: jest.fn(),
    };
    const controller = new MembershipController(memberships as never);

    return { controller, memberships };
  }

  const user = { userId: 'admin-1' } as AuthenticatedUser;

  it('delegates list to MembershipService.listMembers', async () => {
    const { controller, memberships } = setup();
    memberships.listMembers.mockResolvedValue([]);

    await controller.list('org-1', user);

    expect(memberships.listMembers).toHaveBeenCalledWith('org-1', 'admin-1');
  });

  it('delegates addMember with the dto fields and the caller', async () => {
    const { controller, memberships } = setup();
    memberships.addMember.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-2',
      role: MembershipRole.MEMBER,
    });

    await controller.addMember(
      'org-1',
      { userId: 'user-2', role: MembershipRole.MEMBER },
      user,
    );

    expect(memberships.addMember).toHaveBeenCalledWith(
      'org-1',
      'user-2',
      MembershipRole.MEMBER,
      'admin-1',
    );
  });

  it('delegates changeRole with the route params, dto, and caller', async () => {
    const { controller, memberships } = setup();
    memberships.changeRole.mockResolvedValue({
      organizationId: 'org-1',
      userId: 'user-2',
      role: MembershipRole.ADMIN,
    });

    await controller.changeRole(
      'org-1',
      'user-2',
      { role: MembershipRole.ADMIN },
      user,
    );

    expect(memberships.changeRole).toHaveBeenCalledWith(
      'org-1',
      'user-2',
      MembershipRole.ADMIN,
      'admin-1',
    );
  });

  it('delegates removeMember with the route params and caller', async () => {
    const { controller, memberships } = setup();
    memberships.removeMember.mockResolvedValue(undefined);

    await controller.removeMember('org-1', 'user-2', user);

    expect(memberships.removeMember).toHaveBeenCalledWith(
      'org-1',
      'user-2',
      'admin-1',
    );
  });
});
