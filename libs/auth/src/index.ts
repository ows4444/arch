/*
 * Module
 */
export * from './auth.module';
export * from './auth.constants';
export type {
  AuthModuleOptions,
  AuthModuleAsyncOptions,
  AuthOptionsFactory,
} from './auth.types';

/*
 * Application services
 */
export * from './application/auth.service';
export * from './application/authorization.service';
export * from './application/token.service';
export * from './application/refresh-token.service';
export * from './application/password-reset.service';
export * from './application/email-verification.service';

/*
 * Ports
 */
export type { PasswordHasher } from './ports/password-hasher.interface';
export type { AccessTokenDenylist } from './ports/access-token-denylist.interface';
export type { AuthEventPublisher } from './ports/auth-event-publisher.interface';
export * from './ports/auth.events';

/*
 * Adapters
 */
export * from './adapters/argon2-password-hasher';
export * from './adapters/noop-access-token-denylist';
export * from './adapters/cache-access-token-denylist';
export * from './adapters/noop-auth-event-publisher';

/*
 * HTTP
 */
export * from './http/auth.controller';
export * from './http/role.controller';

/*
 * Guards & decorators
 */
export * from './guards/jwt-auth.guard';
export * from './guards/permissions.guard';
export * from './guards/roles.guard';
export * from './decorators/current-user.decorator';
export * from './decorators/public.decorator';
export * from './decorators/roles.decorator';
export * from './decorators/permissions.decorator';

/*
 * DTOs
 */
export * from './dto/register.dto';
export * from './dto/login.dto';
export * from './dto/refresh.dto';
export * from './dto/register-response.dto';
export * from './dto/auth-session-response.dto';
export * from './dto/active-session-response.dto';
export * from './dto/authenticated-user-response.dto';
export * from './dto/create-role.dto';
export * from './dto/create-permission.dto';
export * from './dto/role-response.dto';
export * from './dto/permission-response.dto';
export * from './dto/request-password-reset.dto';
export * from './dto/confirm-password-reset.dto';
export * from './dto/request-email-verification.dto';
export * from './dto/confirm-email-verification.dto';
export * from './dto/change-password.dto';

/*
 * Domain
 */
export * from './domain/user.entity';
export * from './domain/role.entity';
export * from './domain/permission.entity';
export * from './domain/refresh-token.entity';
export * from './domain/auth-token.entity';
export * from './domain/auth-token-purpose.enum';
export * from './domain/user-status.enum';
export * from './domain/user.repository';
export * from './domain/role.repository';
export * from './domain/permission.repository';
export * from './domain/refresh-token.repository';
export * from './domain/auth-token.repository';

/*
 * Errors
 */
export * from './errors/invalid-credentials.error';
export * from './errors/account-disabled.error';
export * from './errors/token-revoked.error';
export * from './errors/insufficient-permissions.error';
export * from './errors/insufficient-role.error';
export * from './errors/email-already-registered.error';
export * from './errors/role-already-exists.error';
export * from './errors/permission-already-exists.error';
export * from './errors/permission-not-found.error';
export * from './errors/role-not-found.error';
export * from './errors/user-not-found.error';
export * from './errors/password-reset-token-invalid.error';
export * from './errors/email-verification-token-invalid.error';
export * from './errors/email-not-verified.error';
export * from './errors/session-not-found.error';

/*
 * Config
 */
export * from './config/auth.schema';

/*
 * Persistence
 */
export {
  AUTH_TYPEORM_ENTITIES,
  UserEntity as AuthUserEntity,
} from './persistence/entities';
export { AUTH_MIGRATIONS } from './persistence/migrations';
