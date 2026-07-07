import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryResolver } from '../repository/repository-resolver';

export type RepositoryClass<T = unknown> = new (
  role: DatabaseRole,
  resolver: RepositoryResolver,
) => T;
