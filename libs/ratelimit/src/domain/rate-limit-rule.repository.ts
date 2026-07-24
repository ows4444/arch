import { BaseRepository, DatabaseRepository } from '@/database';
import { RateLimitRuleEntity } from './rate-limit-rule.entity';

@DatabaseRepository(RateLimitRuleEntity)
export class RateLimitRuleRepository extends BaseRepository<RateLimitRuleEntity> {
  protected readonly entity = RateLimitRuleEntity;

  findByName(name: string): Promise<RateLimitRuleEntity | null> {
    return this.findOneBy({ name });
  }
}
