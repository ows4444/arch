/*
 * Module
 */
export * from './users.module';
export * from './users.constants';
export type {
  UsersModuleOptions,
  UsersModuleAsyncOptions,
  UsersOptionsFactory,
} from './users.types';

/*
 * Application services
 */
export * from './application/user-profile.service';

/*
 * HTTP
 */
export * from './http/user-profile.controller';

/*
 * DTOs
 */
export * from './dto/update-profile.dto';
export * from './dto/user-profile-response.dto';

/*
 * Domain
 */
export * from './domain/user-profile.entity';
export * from './domain/user-profile.repository';

/*
 * Errors
 */
export * from './errors/user-profile-not-found.error';
export * from './errors/forbidden-profile-access.error';

/*
 * Persistence
 */
export { USERS_TYPEORM_ENTITIES } from './persistence/entities';
export { USERS_MIGRATIONS } from './persistence/migrations';
