import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';

export interface UsersModuleOptions {
  /**
   * The permission `assertOwnerOrPermission` accepts as an override when the
   * acting user isn't the profile's owner. Defaults to
   * `DEFAULT_MANAGE_OTHERS_PERMISSION` ('users:manage').
   */
  manageOthersPermission?: string;
}

export interface UsersOptionsFactory {
  createUsersOptions(): UsersModuleOptions | Promise<UsersModuleOptions>;
}

export interface UsersModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<UsersOptionsFactory>;

  useClass?: Type<UsersOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => UsersModuleOptions | Promise<UsersModuleOptions>;
}
