import { BaseRepository, DatabaseRepository } from '@/database';
import { RoleEntity } from './role.entity';
import { isDuplicateKeyError } from './is-duplicate-key-error';

@DatabaseRepository(RoleEntity)
export class RoleRepository extends BaseRepository<RoleEntity> {
  protected readonly entity = RoleEntity;

  findByName(name: string): Promise<RoleEntity | null> {
    return this.findOne({
      where: { name },
      relations: { permissions: true },
    });
  }

  /**
   * Adds a single `(roleId, permissionId)` row to the `auth_role_permissions`
   * join table directly. See `UserRepository.addRole`'s doc comment for why
   * this replaces a load-modify-`save()` round trip.
   */
  async addPermission(roleId: string, permissionId: string): Promise<void> {
    try {
      await this.repository
        .createQueryBuilder()
        .relation(RoleEntity, 'permissions')
        .of(roleId)
        .add(permissionId);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /**
   * Removes a single `(roleId, permissionId)` row from the
   * `auth_role_permissions` join table directly. See `UserRepository.
   * removeRole`'s doc comment for why a no-match `DELETE` is a normal no-op.
   */
  async removePermission(roleId: string, permissionId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .relation(RoleEntity, 'permissions')
      .of(roleId)
      .remove(permissionId);
  }
}
