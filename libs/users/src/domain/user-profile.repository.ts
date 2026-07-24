import { BaseRepository, DatabaseRepository } from '@/database';
import { UserProfileEntity } from './user-profile.entity';

@DatabaseRepository(UserProfileEntity)
export class UserProfileRepository extends BaseRepository<UserProfileEntity> {
  protected readonly entity = UserProfileEntity;

  findByUserId(userId: string): Promise<UserProfileEntity | null> {
    return this.findOne({ where: { userId } });
  }
}
