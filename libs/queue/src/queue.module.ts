import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { RMQConnection } from './connection/rmq.connection';
import { RMQConsumerRuntime } from './consumer/rmq-consumer.runtime';
import { RMQHandlerRegistry } from './consumer/rmq-handler.registry';
import { RMQContextFactory } from './context/rmq-context.factory';
import { RMQPublisher } from './publisher/rmq.publisher';
import {
  QUEUE_INBOX_SERVICE,
  QUEUE_OUTBOX_OPTIONS,
  RMQ_MODULE_OPTIONS,
} from './queue.constants';
import type {
  QueueModuleAsyncOptions,
  QueueModuleOptions,
  QueueOptionsFactory,
} from './queue.types';
import { TopologyBootstrap } from './topology/topology.bootstrap';
import { OutboxService } from './outbox/outbox.service';
import { OutboxDispatcherService } from './outbox/outbox-dispatcher.service';
import { NoopQueueInboxService } from './inbox/noop-queue-inbox.service';
import { DatabaseQueueInboxService } from './inbox/database-queue-inbox.service';

@Global()
@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [DiscoveryModule, ScheduleModule.forRoot()],
      providers: [
        {
          provide: RMQ_MODULE_OPTIONS,
          useValue: options,
        },
        ...this.coreProviders(options),
      ],

      exports: [RMQPublisher, ...(options.outbox ? [OutboxService] : [])],
    };
  }

  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [
        DiscoveryModule,
        ScheduleModule.forRoot(),
        ...(options.imports ?? []),
      ],
      providers: [
        ...this.createAsyncOptionsProviders(options),
        RMQConnection,
        RMQPublisher,
        RMQContextFactory,
        RMQHandlerRegistry,
        RMQConsumerRuntime,
        TopologyBootstrap,

        // The resolved outbox/inbox config is only known once RMQ_MODULE_OPTIONS
        // resolves at runtime, so — unlike forRoot's static branching — these
        // providers are always registered and each decides at runtime (via its
        // own no-op default / an `undefined` options check) whether to activate.
        {
          provide: QUEUE_OUTBOX_OPTIONS,
          useFactory: (moduleOptions: QueueModuleOptions) =>
            moduleOptions.outbox,
          inject: [RMQ_MODULE_OPTIONS],
        },
        OutboxService,
        OutboxDispatcherService,
        NoopQueueInboxService,
        DatabaseQueueInboxService,
        {
          provide: QUEUE_INBOX_SERVICE,
          useFactory: (
            moduleOptions: QueueModuleOptions,
            noop: NoopQueueInboxService,
            database: DatabaseQueueInboxService,
          ) => (moduleOptions.inbox ? database : noop),
          inject: [
            RMQ_MODULE_OPTIONS,
            NoopQueueInboxService,
            DatabaseQueueInboxService,
          ],
        },
      ],
      exports: [RMQPublisher, OutboxService],
    };
  }

  private static createAsyncOptionsProviders(
    options: QueueModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: RMQ_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject ?? [],
        },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: RMQ_MODULE_OPTIONS,
          useFactory: (factory: QueueOptionsFactory) =>
            factory.createQueueOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    if (options.useClass) {
      return [
        options.useClass,
        {
          provide: RMQ_MODULE_OPTIONS,
          useFactory: (factory: QueueOptionsFactory) =>
            factory.createQueueOptions(),
          inject: [options.useClass],
        },
      ];
    }

    throw new Error('Invalid QueueModuleAsyncOptions.');
  }

  private static coreProviders(options: QueueModuleOptions): Provider[] {
    return [
      RMQConnection,
      RMQPublisher,
      RMQContextFactory,
      RMQHandlerRegistry,
      RMQConsumerRuntime,
      TopologyBootstrap,

      ...this.inboxProviders(options.inbox),
      ...this.outboxProviders(options.outbox),
    ];
  }

  private static inboxProviders(enabled: boolean | undefined): Provider[] {
    if (!enabled) {
      return [
        NoopQueueInboxService,
        { provide: QUEUE_INBOX_SERVICE, useExisting: NoopQueueInboxService },
      ];
    }

    return [
      DatabaseQueueInboxService,
      { provide: QUEUE_INBOX_SERVICE, useExisting: DatabaseQueueInboxService },
    ];
  }

  private static outboxProviders(
    outbox: QueueModuleOptions['outbox'],
  ): Provider[] {
    if (!outbox) {
      return [];
    }

    return [
      { provide: QUEUE_OUTBOX_OPTIONS, useValue: outbox },
      OutboxService,
      OutboxDispatcherService,
    ];
  }
}
