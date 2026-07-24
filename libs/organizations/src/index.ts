/*
 * Module
 */
export * from './organizations.module';
export * from './organizations.constants';
export type {
  OrganizationsModuleOptions,
  OrganizationsModuleAsyncOptions,
  OrganizationsOptionsFactory,
} from './organizations.types';

/*
 * Application services
 */
export * from './application/organization.service';
export * from './application/membership.service';

/*
 * HTTP
 */
export * from './http/organization.controller';
export * from './http/membership.controller';

/*
 * DTOs
 */
export * from './dto/create-organization.dto';
export * from './dto/organization-response.dto';
export * from './dto/membership-response.dto';
export * from './dto/add-member.dto';
export * from './dto/change-member-role.dto';

/*
 * Domain
 */
export * from './domain/organization.entity';
export * from './domain/organization.repository';
export * from './domain/membership.entity';
export * from './domain/membership.repository';
export * from './domain/membership-role.enum';

/*
 * Errors
 */
export * from './errors/organization-not-found.error';
export * from './errors/membership-not-found.error';
export * from './errors/forbidden-organization-access.error';
export * from './errors/already-a-member.error';
export * from './errors/cannot-remove-last-owner.error';

/*
 * Persistence
 */
export { ORGANIZATIONS_TYPEORM_ENTITIES } from './persistence/entities';
export { ORGANIZATIONS_MIGRATIONS } from './persistence/migrations';
