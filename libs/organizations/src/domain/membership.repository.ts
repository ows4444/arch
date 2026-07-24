import { BaseRepository, DatabaseRepository } from '@/database';
import { MembershipEntity } from './membership.entity';
import { MembershipRole } from './membership-role.enum';

@DatabaseRepository(MembershipEntity)
export class MembershipRepository extends BaseRepository<MembershipEntity> {
  protected readonly entity = MembershipEntity;

  findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<MembershipEntity | null> {
    return this.findOne({ where: { organizationId, userId } });
  }

  findByOrganization(organizationId: string): Promise<MembershipEntity[]> {
    return this.find({ where: { organizationId } });
  }

  countByOrganizationAndRole(
    organizationId: string,
    role: MembershipRole,
  ): Promise<number> {
    return this.count({ where: { organizationId, role } });
  }
}
