import { UniquePermissionNameSpecification } from './unique-permission-name.specification';
import type { PermissionRepository } from '../domain/permission.repository';

describe('UniquePermissionNameSpecification', () => {
  function fakePermissions(
    existing: { name: string } | null,
  ): PermissionRepository {
    return { findByName: jest.fn(() => Promise.resolve(existing)) } as never;
  }

  it('is satisfied when no permission with that name exists', async () => {
    const spec = new UniquePermissionNameSpecification(fakePermissions(null));

    expect(await spec.isSatisfiedBy('roles:manage')).toBe(true);
    expect(await spec.explain('roles:manage')).toEqual([]);
  });

  it('is not satisfied when a permission with that name already exists', async () => {
    const spec = new UniquePermissionNameSpecification(
      fakePermissions({ name: 'roles:manage' }),
    );

    expect(await spec.isSatisfiedBy('roles:manage')).toBe(false);
    expect(await spec.explain('roles:manage')).toEqual([
      "Permission 'roles:manage' already exists.",
    ]);
  });
});
