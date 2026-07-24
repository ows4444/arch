import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import {
  EMAIL_SENDER,
  NOTIFICATION_MODULE_OPTIONS,
} from './notification.constants';
import type {
  NotificationModuleAsyncOptions,
  NotificationModuleOptions,
  NotificationOptionsFactory,
} from './notification.types';
import { NoopEmailSender } from './adapters/noop-email-sender';
import { NotificationService } from './application/notification.service';

const CORE_EXPORTS = [NotificationService, EMAIL_SENDER];

@Global()
@Module({})
export class NotificationModule {
  static forRoot(options: NotificationModuleOptions = {}): DynamicModule {
    return {
      module: NotificationModule,
      global: true,
      providers: [
        { provide: NOTIFICATION_MODULE_OPTIONS, useValue: options },
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  static forRootAsync(options: NotificationModuleAsyncOptions): DynamicModule {
    return {
      module: NotificationModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        ...this.coreProviders(),
      ],
      exports: CORE_EXPORTS,
    };
  }

  private static coreProviders(): Provider[] {
    return [
      NoopEmailSender,
      {
        provide: EMAIL_SENDER,
        inject: [NOTIFICATION_MODULE_OPTIONS, NoopEmailSender],
        useFactory: (
          moduleOptions: NotificationModuleOptions,
          fallback: NoopEmailSender,
        ) => moduleOptions.emailSender ?? fallback,
      },
      NotificationService,
    ];
  }

  private static createAsyncOptionsProviders(
    options: NotificationModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: NOTIFICATION_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: NOTIFICATION_MODULE_OPTIONS,
          useFactory: (factory: NotificationOptionsFactory) =>
            factory.createNotificationOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: NOTIFICATION_MODULE_OPTIONS,
          useFactory: (factory: NotificationOptionsFactory) =>
            factory.createNotificationOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid NotificationModuleAsyncOptions.');
  }
}
