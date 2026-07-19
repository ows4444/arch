import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import {
  ACCESS_TOKEN_DENYLIST,
  AUTH_EVENT_PUBLISHER,
  AUTH_MODULE_OPTIONS,
  PASSWORD_HASHER,
} from './auth.constants';
import type { AuthModuleAsyncOptions, AuthModuleOptions } from './auth.types';
import { AuthConfigModule } from './auth-config.module';
import { AuthService } from './application/auth.service';
import { AuthorizationService } from './application/authorization.service';
import { TokenService } from './application/token.service';
import { RefreshTokenService } from './application/refresh-token.service';
import { Argon2PasswordHasher } from './adapters/argon2-password-hasher';
import { NoopAccessTokenDenylist } from './adapters/noop-access-token-denylist';
import { NoopAuthEventPublisher } from './adapters/noop-auth-event-publisher';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthController } from './http/auth.controller';

const CORE_EXPORTS = [
  AuthService,
  AuthorizationService,
  TokenService,
  JwtAuthGuard,
  PermissionsGuard,
  RolesGuard,
  PASSWORD_HASHER,
  ACCESS_TOKEN_DENYLIST,
  AUTH_EVENT_PUBLISHER,
];

@Global()
@Module({})
export class AuthModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: [
        AuthConfigModule.forRoot(options),
        JwtModule.register({ secret: options.jwt.secret }),
      ],
      controllers: [AuthController],
      providers: [
        ...this.corePortProviders(),
        {
          provide: PASSWORD_HASHER,
          inject: [Argon2PasswordHasher],
          useFactory: (fallback: Argon2PasswordHasher) =>
            options.passwordHasher ?? fallback,
        },
        {
          provide: ACCESS_TOKEN_DENYLIST,
          inject: [NoopAccessTokenDenylist],
          useFactory: (fallback: NoopAccessTokenDenylist) =>
            options.accessTokenDenylist ?? fallback,
        },
        {
          provide: AUTH_EVENT_PUBLISHER,
          inject: [NoopAuthEventPublisher],
          useFactory: (fallback: NoopAuthEventPublisher) =>
            options.eventPublisher ?? fallback,
        },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  static forRootAsync(options: AuthModuleAsyncOptions): DynamicModule {
    return {
      module: AuthModule,
      global: true,
      imports: [
        AuthConfigModule.forRootAsync(options),
        JwtModule.registerAsync({
          inject: [AUTH_MODULE_OPTIONS],
          useFactory: (moduleOptions: AuthModuleOptions) => ({
            secret: moduleOptions.jwt.secret,
          }),
        }),
      ],
      controllers: [AuthController],
      providers: [
        ...this.corePortProviders(),
        {
          provide: PASSWORD_HASHER,
          inject: [AUTH_MODULE_OPTIONS, Argon2PasswordHasher],
          useFactory: (
            moduleOptions: AuthModuleOptions,
            fallback: Argon2PasswordHasher,
          ) => moduleOptions.passwordHasher ?? fallback,
        },
        {
          provide: ACCESS_TOKEN_DENYLIST,
          inject: [AUTH_MODULE_OPTIONS, NoopAccessTokenDenylist],
          useFactory: (
            moduleOptions: AuthModuleOptions,
            fallback: NoopAccessTokenDenylist,
          ) => moduleOptions.accessTokenDenylist ?? fallback,
        },
        {
          provide: AUTH_EVENT_PUBLISHER,
          inject: [AUTH_MODULE_OPTIONS, NoopAuthEventPublisher],
          useFactory: (
            moduleOptions: AuthModuleOptions,
            fallback: NoopAuthEventPublisher,
          ) => moduleOptions.eventPublisher ?? fallback,
        },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static coreProviders(): Provider[] {
    return [
      TokenService,
      RefreshTokenService,
      AuthService,
      AuthorizationService,
      JwtAuthGuard,
      PermissionsGuard,
      RolesGuard,
    ];
  }

  private static corePortProviders(): Provider[] {
    return [
      Argon2PasswordHasher,
      NoopAccessTokenDenylist,
      NoopAuthEventPublisher,
    ];
  }
}
