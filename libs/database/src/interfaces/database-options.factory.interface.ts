import type { ResolvedDatabaseOptions } from './database-resolved-options.interface';

export interface DatabaseOptionsFactory {
  createDatabaseOptions():
    Promise<ResolvedDatabaseOptions> | ResolvedDatabaseOptions;
}
