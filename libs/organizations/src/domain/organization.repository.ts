import { BaseRepository, DatabaseRepository } from '@/database';
import { OrganizationEntity } from './organization.entity';

@DatabaseRepository(OrganizationEntity)
export class OrganizationRepository extends BaseRepository<OrganizationEntity> {
  protected readonly entity = OrganizationEntity;
}
