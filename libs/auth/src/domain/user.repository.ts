import { BaseRepository, DatabaseRepository } from '@/database';
import { UserEntity } from './user.entity';
import { isDuplicateKeyError } from './is-duplicate-key-error';

@DatabaseRepository(UserEntity)
export class UserRepository extends BaseRepository<UserEntity> {
  protected readonly entity = UserEntity;

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.findOne({
      where: { email: email.toLowerCase() },
      relations: { roles: { permissions: true } },
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.findOne({
      where: { id },
      relations: { roles: { permissions: true } },
    });
  }

  /**
   * Adds a single `(userId, roleId)` row to the `auth_user_roles` join
   * table directly, via TypeORM's relation query builder, instead of
   * `AuthorizationService` loading the full `roles` array and `save()`-ing
   * a recomputed one back. The load-modify-`save()` pattern is TypeORM's
   * default *full sync* for an owning-side many-to-many relation — two
   * concurrent calls each computing their own "desired final state" from
   * the same stale read would race, and whichever `save()` landed second
   * would silently overwrite the first's grant. A single-row `INSERT` has
   * no such race: it either succeeds or hits the join table's own
   * `(userId, roleId)` primary key, which is caught below and treated as
   * "already assigned" — matching the previous no-op-on-duplicate behavior,
   * atomically, on every driver (no pessimistic locking, which
   * `better-sqlite3` — used by this library's integration tests — doesn't
   * support at all).
   */
  async addRole(userId: string, roleId: string): Promise<void> {
    try {
      await this.repository
        .createQueryBuilder()
        .relation(UserEntity, 'roles')
        .of(userId)
        .add(roleId);
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }
  }

  /**
   * Removes a single `(userId, roleId)` row from the `auth_user_roles`
   * join table directly — see `addRole`'s doc comment for why this
   * replaces a load-modify-`save()` round trip. A `DELETE` matching zero
   * rows (the user never had the role) is a normal no-op, not an error.
   */
  async removeRole(userId: string, roleId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .relation(UserEntity, 'roles')
      .of(userId)
      .remove(roleId);
  }
}
