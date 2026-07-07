import { Provider } from '@nestjs/common';

import 'reflect-metadata';

import { DatabaseRole } from '../constants/database-role.enum';
import { RepositoryClass } from '../interfaces/repository-class.interface';
import type { RepositoryMetadata } from '../interfaces/repository-metadata.interface';
import { RepositoryResolver } from './repository-resolver';
import {
  DATABASE_REPOSITORY_METADATA,
  getRepositoryToken,
} from './repository.tokens';

export class RepositoryProviderFactory {
  static create(repositories: readonly RepositoryClass[]): Provider[] {
    return repositories.flatMap((repository) => {
      const metadata = Reflect.getMetadata(
        DATABASE_REPOSITORY_METADATA,
        repository,
      ) as RepositoryMetadata | undefined;

      if (!metadata) {
        throw new Error(
          [
            `Repository '${repository.name}' is not registered correctly.`,
            '',
            'Every custom repository must be decorated:',
            '',
            '@DatabaseRepository(Entity)',
            '',
            `Example:`,
            `@DatabaseRepository(UserEntity)`,
            `export class ${repository.name} extends BaseRepository<UserEntity> {}`,
          ].join('\n'),
        );
      }

      return [
        this.createProvider(repository, DatabaseRole.READ),
        this.createProvider(repository, DatabaseRole.WRITE),
      ];
    });
  }

  private static createProvider(
    repository: RepositoryClass,
    role: DatabaseRole,
  ): Provider {
    return {
      provide: getRepositoryToken(repository, role),

      inject: [RepositoryResolver],

      useFactory: (resolver: RepositoryResolver) => {
        return new repository(role, resolver);
      },
    };
  }
}
