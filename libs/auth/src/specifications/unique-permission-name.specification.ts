import type { Specification } from '@/validation';
import type { PermissionRepository } from '../domain/permission.repository';

export class UniquePermissionNameSpecification implements Specification<string> {
  readonly name = 'UniquePermissionName';

  constructor(private readonly permissions: PermissionRepository) {}

  async isSatisfiedBy(candidateName: string): Promise<boolean> {
    return !(await this.permissions.findByName(candidateName));
  }

  async explain(candidateName: string): Promise<string[]> {
    if (await this.isSatisfiedBy(candidateName)) {
      return [];
    }

    return [`Permission '${candidateName}' already exists.`];
  }
}
