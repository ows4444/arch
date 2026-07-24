/*
 * Module
 */
export * from './notification.module';
export * from './notification.constants';
export type {
  NotificationModuleOptions,
  NotificationModuleAsyncOptions,
  NotificationOptionsFactory,
} from './notification.types';

/*
 * Application
 */
export * from './application/notification.service';

/*
 * Ports
 */
export type { EmailSender } from './ports/email-sender.interface';
export type { EmailMessage } from './ports/email-message.interface';

/*
 * Adapters
 */
export * from './adapters/noop-email-sender';
export * from './adapters/logging-email-sender';

/*
 * Queue (shared topology/payload — see ARCH.md Context Map)
 */
export * from './queue/notification-email.topology';
export * from './queue/email-message.payload';
