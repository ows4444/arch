import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';

export interface OrganizationsModuleOptions {
  /**
   * The permission `assertOrgRole` accepts as a platform-level override when
   * the acting user's membership role (if any) doesn't satisfy the required
   * role. Defaults to `DEFAULT_MANAGE_ORGANIZATIONS_PERMISSION`
   * ('organizations:manage').
   */
  manageOrganizationsPermission?: string;
}

export interface OrganizationsOptionsFactory {
  createOrganizationsOptions():
    OrganizationsModuleOptions | Promise<OrganizationsModuleOptions>;
}

export interface OrganizationsModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<OrganizationsOptionsFactory>;

  useClass?: Type<OrganizationsOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => OrganizationsModuleOptions | Promise<OrganizationsModuleOptions>;
}
