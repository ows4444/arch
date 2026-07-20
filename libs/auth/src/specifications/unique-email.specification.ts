import type { Specification } from '@/validation';
import type { UserRepository } from '../domain/user.repository';

export class UniqueEmailSpecification implements Specification<string> {
  readonly name = 'UniqueEmail';

  constructor(private readonly users: UserRepository) {}

  async isSatisfiedBy(candidateEmail: string): Promise<boolean> {
    return !(await this.users.findByEmail(candidateEmail));
  }

  async explain(candidateEmail: string): Promise<string[]> {
    if (await this.isSatisfiedBy(candidateEmail)) {
      return [];
    }

    return [`Email '${candidateEmail}' is already registered.`];
  }
}
