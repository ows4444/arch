import { OrganizationController } from './organization.controller';
import type { AuthenticatedUser } from '@/auth';

describe('OrganizationController', () => {
  function setup() {
    const organizations = {
      create: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
    };
    const controller = new OrganizationController(organizations as never);

    return { controller, organizations };
  }

  const user = { userId: 'user-1' } as AuthenticatedUser;

  it('delegates create to OrganizationService.create with the caller as owner', async () => {
    const { controller, organizations } = setup();
    organizations.create.mockResolvedValue({ id: 'org-1', name: 'Acme' });

    const result = await controller.create({ name: 'Acme' }, user);

    expect(organizations.create).toHaveBeenCalledWith('Acme', 'user-1');
    expect(result).toEqual({ id: 'org-1', name: 'Acme' });
  });

  it('delegates get with the route param and the caller as separate arguments', async () => {
    const { controller, organizations } = setup();
    organizations.get.mockResolvedValue({ id: 'org-1', name: 'Acme' });

    await controller.get('org-1', user);

    expect(organizations.get).toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('delegates delete with the route param and the caller as separate arguments', async () => {
    const { controller, organizations } = setup();
    organizations.delete.mockResolvedValue(undefined);

    await controller.delete('org-1', user);

    expect(organizations.delete).toHaveBeenCalledWith('org-1', 'user-1');
  });
});
