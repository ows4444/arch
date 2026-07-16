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
import type { QueueModuleOptions } from './queue.types';
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
        RMQConnection,
        RMQPublisher,
        RMQContextFactory,
        RMQHandlerRegistry,
        RMQConsumerRuntime,
        TopologyBootstrap,

        ...this.inboxProviders(options.inbox),
        ...this.outboxProviders(options.outbox),
      ],

      exports: [RMQPublisher, ...(options.outbox ? [OutboxService] : [])],
    };
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
