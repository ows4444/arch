import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
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

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    @InjectRepository(RoleRepository)
    private readonly roles: RoleRepository,
    @InjectRepository(PermissionRepository)
    private readonly permissions: PermissionRepository,
  ) {}

  async createPermission(
    name: string,
    description?: string,
  ): Promise<PermissionEntity> {
    if (await this.permissions.findByName(name)) {
      throw new PermissionAlreadyExistsError(name);
    }

    return this.permissions.save({ name, description: description ?? null });
  }

  async createRole(
    name: string,
    permissionNames: string[] = [],
  ): Promise<RoleEntity> {
    if (await this.roles.findByName(name)) {
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

    return this.roles.save({ name, permissions: grantedPermissions });
  }

  listRoles(): Promise<RoleEntity[]> {
    return this.roles.find({ relations: { permissions: true } });
  }

  async assignRole(userId: string, roleName: string): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    if (user.roles.some((existing) => existing.id === role.id)) {
      return;
    }

    await this.users.save({ id: user.id, roles: [...user.roles, role] });
  }

  async revokeRole(userId: string, roleName: string): Promise<void> {
    const user = await this.users.findById(userId);

    if (!user) {
      throw new UserNotFoundError(userId);
    }

    const role = await this.roles.findByName(roleName);

    if (!role) {
      throw new RoleNotFoundError(roleName);
    }

    await this.users.save({
      id: user.id,
      roles: user.roles.filter((existing) => existing.id !== role.id),
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
