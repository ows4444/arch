import { BaseRepository, DatabaseRepository } from '@/database';
import { RoleEntity } from './role.entity';

@DatabaseRepository(RoleEntity)
export class RoleRepository extends BaseRepository<RoleEntity> {
  protected readonly entity = RoleEntity;

  findByName(name: string): Promise<RoleEntity | null> {
    return this.findOne({
      where: { name },
      relations: { permissions: true },
    });
  }
}
