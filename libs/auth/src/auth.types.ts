import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { PasswordHasher } from './ports/password-hasher.interface';
import type { AccessTokenDenylist } from './ports/access-token-denylist.interface';
import type { AuthEventPublisher } from './ports/auth-event-publisher.interface';

export interface AuthModuleOptions {
  jwt: {
    secret: string;

    accessTokenTtlSeconds?: number;
  };

  refreshTokenTtlSeconds?: number;

  /**
   * Caps how many refresh tokens (i.e. distinct logged-in devices/sessions)
   * a single user can have active at once. Issuing a new one past the cap
   * silently evicts the least-recently-issued active session rather than
   * rejecting the new login — see `RefreshTokenService.issue`. Defaults to
   * `DEFAULT_MAX_ACTIVE_SESSIONS_PER_USER` (5).
   */
  maxActiveSessionsPerUser?: number;

  /**
   * How long a revoked or naturally-expired refresh token row is kept
   * before the scheduled purge job deletes it. Defaults to
   * `DEFAULT_REFRESH_TOKEN_PURGE_GRACE_SECONDS` (24h). See
   * `RefreshTokenRepository.deleteExpiredAndRevoked`.
   */
  refreshTokenPurgeGraceSeconds?: number;

  passwordResetTokenTtlSeconds?: number;

  emailVerificationTokenTtlSeconds?: number;

  passwordHasher?: PasswordHasher;

  accessTokenDenylist?: AccessTokenDenylist;

  eventPublisher?: AuthEventPublisher;
}

export interface AuthOptionsFactory {
  createAuthOptions(): AuthModuleOptions | Promise<AuthModuleOptions>;
}

export interface AuthModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<AuthOptionsFactory>;

  useClass?: Type<AuthOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => AuthModuleOptions | Promise<AuthModuleOptions>;
}
