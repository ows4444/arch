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
