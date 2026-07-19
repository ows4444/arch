import { In } from 'typeorm';
import { BaseRepository, DatabaseRepository } from '@/database';
import { PermissionEntity } from './permission.entity';

@DatabaseRepository(PermissionEntity)
export class PermissionRepository extends BaseRepository<PermissionEntity> {
  protected readonly entity = PermissionEntity;

  findByName(name: string): Promise<PermissionEntity | null> {
    return this.findOneBy({ name });
  }

  findByNames(names: string[]): Promise<PermissionEntity[]> {
    if (names.length === 0) {
      return Promise.resolve([]);
    }

    return this.findBy({ name: In(names) });
  }
}
