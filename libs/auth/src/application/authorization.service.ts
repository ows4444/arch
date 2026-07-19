import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@/database';
import { UserRepository } from '../domain/user.repository';
import { RoleRepository } from '../domain/role.repository';
import { InsufficientPermissionsError } from '../errors/insufficient-permissions.error';

@Injectable()
export class AuthorizationService {
  constructor(
    @InjectRepository(UserRepository)
    private readonly users: UserRepository,
    @InjectRepository(RoleRepository)
    private readonly roles: RoleRepository,
  ) {}

  async assignRole(userId: string, roleName: string): Promise<void> {
    const user = await this.users.findById(userId);
    const role = await this.roles.findByName(roleName);

    if (!user || !role) {
      return;
    }

    if (user.roles.some((existing) => existing.id === role.id)) {
      return;
    }

    await this.users.save({ id: user.id, roles: [...user.roles, role] });
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
