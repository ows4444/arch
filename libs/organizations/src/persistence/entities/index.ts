import { OrganizationEntity } from '../../domain/organization.entity';
import { MembershipEntity } from '../../domain/membership.entity';

export const ORGANIZATIONS_TYPEORM_ENTITIES = [
  OrganizationEntity,
  MembershipEntity,
] as const;

export { OrganizationEntity } from '../../domain/organization.entity';
export { MembershipEntity } from '../../domain/membership.entity';
