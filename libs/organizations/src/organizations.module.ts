import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { ORGANIZATIONS_MODULE_OPTIONS } from './organizations.constants';
import type {
  OrganizationsModuleAsyncOptions,
  OrganizationsModuleOptions,
  OrganizationsOptionsFactory,
} from './organizations.types';
import { OrganizationService } from './application/organization.service';
import { MembershipService } from './application/membership.service';
import { OrganizationController } from './http/organization.controller';
import { MembershipController } from './http/membership.controller';

const CORE_EXPORTS = [OrganizationService, MembershipService];

@Global()
@Module({})
export class OrganizationsModule {
  static forRoot(options: OrganizationsModuleOptions = {}): DynamicModule {
    return {
      module: OrganizationsModule,
      global: true,
      controllers: [OrganizationController, MembershipController],
      providers: [
        { provide: ORGANIZATIONS_MODULE_OPTIONS, useValue: options },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  static forRootAsync(options: OrganizationsModuleAsyncOptions): DynamicModule {
    return {
      module: OrganizationsModule,
      global: true,
      imports: options.imports ?? [],
      controllers: [OrganizationController, MembershipController],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static coreProviders(): Provider[] {
    return [OrganizationService, MembershipService];
  }

  private static createAsyncOptionsProviders(
    options: OrganizationsModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: ORGANIZATIONS_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: ORGANIZATIONS_MODULE_OPTIONS,
          useFactory: (factory: OrganizationsOptionsFactory) =>
            factory.createOrganizationsOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: ORGANIZATIONS_MODULE_OPTIONS,
          useFactory: (factory: OrganizationsOptionsFactory) =>
            factory.createOrganizationsOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid OrganizationsModuleAsyncOptions.');
  }
}
