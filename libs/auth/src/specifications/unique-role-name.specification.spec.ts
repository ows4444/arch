import { UniqueRoleNameSpecification } from './unique-role-name.specification';
import type { RoleRepository } from '../domain/role.repository';

describe('UniqueRoleNameSpecification', () => {
  function fakeRoles(existing: { name: string } | null): RoleRepository {
    return { findByName: jest.fn(() => Promise.resolve(existing)) } as never;
  }

  it('is satisfied when no role with that name exists', async () => {
    const spec = new UniqueRoleNameSpecification(fakeRoles(null));

    expect(await spec.isSatisfiedBy('admin')).toBe(true);
    expect(await spec.explain('admin')).toEqual([]);
  });

  it('is not satisfied when a role with that name already exists', async () => {
    const spec = new UniqueRoleNameSpecification(fakeRoles({ name: 'admin' }));

    expect(await spec.isSatisfiedBy('admin')).toBe(false);
    expect(await spec.explain('admin')).toEqual([
      "Role 'admin' already exists.",
    ]);
  });
});
