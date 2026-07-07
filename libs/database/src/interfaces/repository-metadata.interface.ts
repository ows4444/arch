import type { EntityTarget } from 'typeorm';
import { RepositoryClass } from './repository-class.interface';

export interface RepositoryMetadata<TEntity = unknown> {
  readonly entity: EntityTarget<TEntity>;

  readonly repository: RepositoryClass;
}
