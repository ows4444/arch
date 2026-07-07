import 'reflect-metadata';

import type { RepositoryClass } from '../interfaces/repository-class.interface';
import type { RepositoryMetadata } from '../interfaces/repository-metadata.interface';
import { DATABASE_REPOSITORY_METADATA } from './repository.tokens';

export class RepositoryRegistry {
  private static readonly repositories = new Set<RepositoryClass>();

  static register(repository: RepositoryClass): void {
    this.repositories.add(repository);
  }

  static all(): readonly RepositoryClass[] {
    return [...this.repositories];
  }

  static metadata(repository: RepositoryClass): RepositoryMetadata | undefined {
    return Reflect.getMetadata(DATABASE_REPOSITORY_METADATA, repository) as
      RepositoryMetadata | undefined;
  }
}
