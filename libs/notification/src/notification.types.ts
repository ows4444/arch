import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { EmailSender } from './ports/email-sender.interface';

export interface NotificationModuleOptions {
  emailSender?: EmailSender;
}

export interface NotificationOptionsFactory {
  createNotificationOptions():
    NotificationModuleOptions | Promise<NotificationModuleOptions>;
}

export interface NotificationModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<NotificationOptionsFactory>;

  useClass?: Type<NotificationOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => NotificationModuleOptions | Promise<NotificationModuleOptions>;
}
