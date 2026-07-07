import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { RepositoryRegistry } from './repository.registry';
import {
  DATABASE_REPOSITORY_METADATA,
  getRepositoryToken,
} from './repository.tokens';
import type { RepositoryMetadata } from '../interfaces/repository-metadata.interface';
import { DatabaseRole } from '../constants/database-role.enum';

@Injectable()
export class RepositoryDiscoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RepositoryDiscoveryService.name);

  onApplicationBootstrap(): void {
    const repositories = RepositoryRegistry.all();

    this.logger.log(`Registered ${repositories.length} database repositories.`);

    for (const repository of repositories) {
      const metadata = Reflect.getMetadata(
        DATABASE_REPOSITORY_METADATA,
        repository,
      ) as RepositoryMetadata | undefined;

      if (!metadata) {
        throw new Error(
          `Repository '${repository.name}' is missing @DatabaseRepository().`,
        );
      }

      this.logger.debug(
        `${repository.name}
READ  -> ${String(getRepositoryToken(repository, DatabaseRole.READ))}
WRITE -> ${String(getRepositoryToken(repository, DatabaseRole.WRITE))}`,
      );
    }
  }
}
