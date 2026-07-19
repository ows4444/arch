import { BaseRepository, DatabaseRepository } from '@/database';
import { UserEntity } from './user.entity';

@DatabaseRepository(UserEntity)
export class UserRepository extends BaseRepository<UserEntity> {
  protected readonly entity = UserEntity;

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.findOne({
      where: { email: email.toLowerCase() },
      relations: { roles: { permissions: true } },
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.findOne({
      where: { id },
      relations: { roles: { permissions: true } },
    });
  }
}
