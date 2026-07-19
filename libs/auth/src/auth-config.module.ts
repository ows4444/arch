import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { AUTH_MODULE_OPTIONS } from './auth.constants';
import type {
  AuthModuleAsyncOptions,
  AuthModuleOptions,
  AuthOptionsFactory,
} from './auth.types';

/**
 * Provides `AUTH_MODULE_OPTIONS` as its own `@Global()` module, separate
 * from `AuthModule` itself. `AuthModule.forRootAsync` needs
 * `JwtModule.registerAsync({ inject: [AUTH_MODULE_OPTIONS] })` to resolve
 * that token — but a nested `imports` entry can't inject a provider
 * declared in its *parent* module's own `providers` array (Nest's DI graph
 * doesn't allow reaching "up" like that, only "down" into imports or
 * across `@Global()` modules). Splitting the options provider into its own
 * global module sidesteps the problem entirely: both `AuthModule`'s own
 * providers and any dynamic module it imports (like `JwtModule`) can see
 * a `@Global()` module's exports.
 */
@Global()
@Module({})
export class AuthConfigModule {
  static forRoot(options: AuthModuleOptions): DynamicModule {
    return {
      module: AuthConfigModule,
      providers: [{ provide: AUTH_MODULE_OPTIONS, useValue: options }],
      exports: [AUTH_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: AuthModuleAsyncOptions): DynamicModule {
    return {
      module: AuthConfigModule,
      imports: options.imports ?? [],
      providers: this.createAsyncOptionsProviders(options),
      exports: [AUTH_MODULE_OPTIONS],
    };
  }

  private static createAsyncOptionsProviders(
    options: AuthModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: AUTH_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: AUTH_MODULE_OPTIONS,
          useFactory: (factory: AuthOptionsFactory) =>
            factory.createAuthOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: AUTH_MODULE_OPTIONS,
          useFactory: (factory: AuthOptionsFactory) =>
            factory.createAuthOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid AuthModuleAsyncOptions.');
  }
}
