import 'reflect-metadata';

import type { RepositoryClass } from '../interfaces/repository-class.interface';
import type { RepositoryMetadata } from '../interfaces/repository-metadata.interface';
import { DATABASE_REPOSITORY_METADATA } from './repository.tokens';

/**
 * Static, process-global registry populated as a side effect of `@DatabaseRepository()`
 * class-decorator evaluation. `RepositoryProviderFactory.create(RepositoryRegistry.all())`
 * runs once, synchronously, during `DatabaseModule.forRoot()`/`forRootAsync()` — any
 * repository class not yet imported (directly or transitively) by that point will
 * silently receive no DI providers. Ensure every `@DatabaseRepository()` class is
 * statically imported somewhere in the app's module graph before `DatabaseModule.forRoot()` runs.
 */
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
