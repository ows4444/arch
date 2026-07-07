import { DynamicModule, Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RMQConnection } from './connection/rmq.connection';
import { RMQConsumerRuntime } from './consumer/rmq-consumer.runtime';
import { RMQHandlerRegistry } from './consumer/rmq-handler.registry';
import { RMQContextFactory } from './context/rmq-context.factory';
import { RMQPublisher } from './publisher/rmq.publisher';
import { RMQ_MODULE_OPTIONS } from './queue.constants';
import type { QueueModuleOptions } from './queue.types';
import { TopologyBootstrap } from './topology/topology.bootstrap';

@Global()
@Module({})
export class QueueModule {
  static forRoot(options: QueueModuleOptions): DynamicModule {
    return {
      module: QueueModule,
      global: true,
      imports: [DiscoveryModule],
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
      ],

      exports: [RMQPublisher],
    };
  }
}
