import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { USERS_MODULE_OPTIONS } from './users.constants';
import type {
  UsersModuleAsyncOptions,
  UsersModuleOptions,
  UsersOptionsFactory,
} from './users.types';
import { UserProfileService } from './application/user-profile.service';
import { UserProfileController } from './http/user-profile.controller';

const CORE_EXPORTS = [UserProfileService];

@Global()
@Module({})
export class UsersModule {
  static forRoot(options: UsersModuleOptions = {}): DynamicModule {
    return {
      module: UsersModule,
      global: true,
      controllers: [UserProfileController],
      providers: [
        { provide: USERS_MODULE_OPTIONS, useValue: options },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  static forRootAsync(options: UsersModuleAsyncOptions): DynamicModule {
    return {
      module: UsersModule,
      global: true,
      imports: options.imports ?? [],
      controllers: [UserProfileController],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static coreProviders(): Provider[] {
    return [UserProfileService];
  }

  private static createAsyncOptionsProviders(
    options: UsersModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: USERS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: USERS_MODULE_OPTIONS,
          useFactory: (factory: UsersOptionsFactory) =>
            factory.createUsersOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: USERS_MODULE_OPTIONS,
          useFactory: (factory: UsersOptionsFactory) =>
            factory.createUsersOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid UsersModuleAsyncOptions.');
  }
}
