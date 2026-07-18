import type {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import type { ClassConstructor } from 'class-transformer';
import { ResolvedRetryPolicy } from './topology/topology.contracts';
import type { QueueOutboxOptions } from './outbox/outbox.types';

export interface RMQQueueRef {
  EXCHANGE_NAME: string;

  QUEUE_NAME: string;

  ROUTING_KEY: string;
}

export interface QueueModuleOptions {
  uri: string;

  topology?: RmqTopologyDefinition[];

  prefetch?: number;

  connectionName?: string;

  outbox?: QueueOutboxOptions;

  inbox?: boolean;
}

export interface QueueOptionsFactory {
  createQueueOptions(): QueueModuleOptions | Promise<QueueModuleOptions>;
}

export interface QueueModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  inject?: (InjectionToken | OptionalFactoryDependency)[];

  useExisting?: Type<QueueOptionsFactory>;

  useClass?: Type<QueueOptionsFactory>;

  useFactory?: (
    ...args: readonly unknown[]
  ) => QueueModuleOptions | Promise<QueueModuleOptions>;
}

export interface RmqTopologyDefinition {
  exchange: string;

  type?: 'direct' | 'topic' | 'fanout' | 'headers';

  durable?: boolean;

  queues: RmqQueueDefinition[];
}

export interface RmqQueueDefinition {
  queue: string;

  routingKey: string;

  durable?: boolean;

  arguments?: Record<string, unknown>;

  retryPolicy?: ResolvedRetryPolicy;

  deadLetterQueue?: {
    queue: string;

    routingKey: string;
  };
}

export interface RmqConsumerOptions<TPayload = unknown> {
  exchange: string;

  queue: string;

  routingKey: string;

  payloadType?: ClassConstructor<TPayload>;

  prefetch?: number;

  retryPolicy?: ResolvedRetryPolicy;

  timeoutMs?: number;
}

export interface RMQContext {
  messageId?: string | undefined;

  requestId: string;

  correlationId?: string | undefined;

  causationId?: string | undefined;

  routingKey: string;

  exchange: string;

  queue: string;

  receivedAt: number;

  signal: AbortSignal;
}
