import type { Specification } from '@/validation';
import type { RoleRepository } from '../domain/role.repository';

export class UniqueRoleNameSpecification implements Specification<string> {
  readonly name = 'UniqueRoleName';

  constructor(private readonly roles: RoleRepository) {}

  async isSatisfiedBy(candidateName: string): Promise<boolean> {
    return !(await this.roles.findByName(candidateName));
  }

  async explain(candidateName: string): Promise<string[]> {
    if (await this.isSatisfiedBy(candidateName)) {
      return [];
    }

    return [`Role '${candidateName}' already exists.`];
  }
}
