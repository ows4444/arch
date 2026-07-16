import 'reflect-metadata';

import type { EntityTarget } from 'typeorm';
import { RepositoryClass } from '../interfaces/repository-class.interface';
import type { RepositoryMetadata } from '../interfaces/repository-metadata.interface';
import { DATABASE_REPOSITORY_METADATA } from '../repository/repository.tokens';
import { RepositoryRegistry } from '../repository/repository.registry';

/**
 * Registers `target` with `RepositoryRegistry` on class evaluation. This only works
 * because Node resolves static imports synchronously before `DatabaseModule.forRoot()`
 * runs — the decorated class must be statically imported (directly or transitively)
 * somewhere in the module import graph *before* that call, or it silently gets no
 * DI providers. See `RepositoryRegistry` for details.
 */
export function DatabaseRepository<TEntity>(
  entity: EntityTarget<TEntity>,
): ClassDecorator {
  return (target) => {
    const metadata: RepositoryMetadata = {
      entity,
      repository: target as unknown as RepositoryClass,
    };

    Reflect.defineMetadata(DATABASE_REPOSITORY_METADATA, metadata, target);

    RepositoryRegistry.register(target as unknown as RepositoryClass);
  };
}
