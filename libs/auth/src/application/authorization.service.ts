import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { AuditService } from '@/audit';
import { UserRepository } from '../domain/user.repository';
import { RoleRepository } from '../domain/role.repository';
import { PermissionRepository } from '../domain/permission.repository';
import { RoleEntity } from '../domain/role.entity';
import { PermissionEntity } from '../domain/permission.entity';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';
import { RoleAlreadyExistsError } from '../errors/role-already-exists.error';
import { PermissionAlreadyExistsError } from '../errors/permission-already-exists.error';
import { PermissionNotFoundError } from '../errors/permission-not-found.error';
import { RoleNotFoundError } from '../errors/role-not-found.error';
import { UserNotFoundError } from '../errors/user-not-found.error';
import { UniqueRoleNameSpecification } from '../specifications/unique-role-name.specification';
import { UniquePermissionNameSpecification } from '../specifications/unique-permission-name.specification';

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    @InjectRepository(RoleRepository)
    private readonly roles: RoleRepository,
    @InjectRepository(PermissionRepository)
    private readonly permissions: PermissionRepository,
    private readonly audit: AuditService,
  ) {}

  async createPermission(
    name: string,
    description?: string,
    actorId?: string,
  ): Promise<PermissionEntity> {
    const uniqueName = new UniquePermissionNameSpecification(this.permissions);

    if (!(await uniqueName.isSatisfiedBy(name))) {
      throw new PermissionAlreadyExistsError(name);
    }

    const created = await this.permissions.save({
      name,
      description: description ?? null,
    });

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'permission.created',
      targetType: 'permission',
      targetId: name,
    });

    return created;
  }

  async createRole(
    name: string,
    permissionNames: string[] = [],
    actorId?: string,
  ): Promise<RoleEntity> {
    const uniqueName = new UniqueRoleNameSpecification(this.roles);

    if (!(await uniqueName.isSatisfiedBy(name))) {
      throw new RoleAlreadyExistsError(name);
    }

    const grantedPermissions =
      await this.permissions.findByNames(permissionNames);

    const missing = permissionNames.filter(
      (requested) =>
        !grantedPermissions.some((granted) => granted.name === requested),
    );

    if (missing.length > 0) {
      throw new PermissionNotFoundError(missing[0]!);
    }

    const created = await this.roles.save({
      name,
      permissions: grantedPermissions,
    });

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'role.created',
      targetType: 'role',
      targetId: name,
      metadata: { permissions: permissionNames },
    });

    return created;
  }

  listRoles(): Promise<RoleEntity[]> {
    return this.roles.find({ relations: { permissions: true } });
  }

  async listUserRoles(userId: string): Promise<RoleEntity[]> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    return user.roles;
  }

  /**
   * `auth_role_permissions`/`auth_user_roles` both declare `onDelete: 'CASCADE'`
   * on their `roleId` foreign key (see `1753000000000-InitialAuthSchema`), so
   * this also revokes the role from every user currently holding it — a
   * deliberate schema choice, not an oversight; the alternative (blocking
   * deletion while in use) would fight that existing cascade rather than use it.
   */
  async deleteRole(roleName: string, actorId?: string): Promise<void> {
    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    await this.roles.delete({ id: role.id });

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'role.deleted',
      targetType: 'role',
      targetId: roleName,
    });
  }

  /**
   * `auth_role_permissions` declares `onDelete: 'CASCADE'` on its
   * `permissionId` foreign key, so this also revokes the permission from
   * every role currently granting it — same cascade reasoning as
   * `deleteRole`.
   */
  async deletePermission(
    permissionName: string,
    actorId?: string,
  ): Promise<void> {
    const permission = await this.permissions.findByName(permissionName);

    if (!permission) {
      throw new PermissionNotFoundError(permissionName);
    }

    await this.permissions.delete({ id: permission.id });

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'permission.deleted',
      targetType: 'permission',
      targetId: permissionName,
    });
  }

  /**
   * `RoleRepository.addPermission` writes a single `(roleId, permissionId)`
   * row directly to the join table rather than this service loading the
   * full `permissions` array and `save()`-ing a recomputed one back —
   * TypeORM's default many-to-many `save()` behavior for an owning-side
   * `@JoinTable` relation is a *full sync* (add + remove diffed against
   * the given array), so two concurrent grant/revoke calls each computing
   * their own "desired final state" from the same stale read could race,
   * silently overwriting one another. A single-row `INSERT` has no such
   * race — it's atomic at the database level on every driver, including
   * `better-sqlite3` (pessimistic row locking, the alternative fix, isn't
   * supported by that driver at all, which every integration test in this
   * library depends on).
   */
  async grantPermission(
    roleName: string,
    permissionName: string,
    actorId?: string,
  ): Promise<RoleEntity> {
    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    const permission = await this.permissions.findByName(permissionName);

    if (!permission) {
      throw new PermissionNotFoundError(permissionName);
    }

    await this.roles.addPermission(role.id, permission.id);

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'permission.granted',
      targetType: 'role',
      targetId: roleName,
      metadata: { permissionName },
    });

    return (await this.roles.findByName(roleName))!;
  }

  /** See `grantPermission`'s doc comment — same race, same fix. */
  async revokePermission(
    roleName: string,
    permissionName: string,
    actorId?: string,
  ): Promise<RoleEntity> {
    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    const permission = await this.permissions.findByName(permissionName);

    if (!permission) {
      throw new PermissionNotFoundError(permissionName);
    }

    await this.roles.removePermission(role.id, permission.id);

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'permission.revoked',
      targetType: 'role',
      targetId: roleName,
      metadata: { permissionName },
    });

    return (await this.roles.findByName(roleName))!;
  }

  /**
   * `UserRepository.addRole` writes a single `(userId, roleId)` row
   * directly to the join table — see `grantPermission`'s doc comment for
   * why this replaces a load-modify-`save()` round trip.
   */
  async assignRole(
    userId: string,
    roleName: string,
    actorId?: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    await this.users.addRole(user.id, role.id);

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'role.assigned',
      targetType: 'user',
      targetId: userId,
      metadata: { roleName },
    });
  }

  /** See `assignRole`'s doc comment — same race, same fix. */
  async revokeRole(
    userId: string,
    roleName: string,
    actorId?: string,
  ): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    await this.users.removeRole(user.id, role.id);

    await this.audit.record({
      ...(actorId !== undefined && { actorId }),
      action: 'role.revoked',
      targetType: 'user',
      targetId: userId,
      metadata: { roleName },
    });
  }

  async hasRole(userId: string, roleName: string): Promise<boolean> {
    const user = await this.users.findById(userId);

    if (!user) {
      return false;
    }

    return user.roles.some((role) => role.name === roleName);
  }

  async hasPermission(userId: string, permission: string): Promise<boolean> {
    const user = await this.users.findById(userId);

    if (!user) {
      return false;
    }

    return user.roles.some((role) =>
      role.permissions.some((granted) => granted.name === permission),
    );
  }

  async assertPermission(userId: string, permission: string): Promise<void> {
    if (!(await this.hasPermission(userId, permission))) {
      throw new InsufficientPermissionsError(permission);
    }
  }
}
