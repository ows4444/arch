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

  /**
   * Upper bound `resolvePrefetch()` enforces on top of `prefetch` /
   * per-consumer overrides. Defaults to `RMQConnection`'s existing 100.
   */
  maxPrefetch?: number;

  /**
   * How many attempts `RMQConnection`'s one-time raw topology-bootstrap
   * connection makes before giving up. Defaults to 10.
   */
  rawConnectionMaxRetries?: number;

  /**
   * Base delay (ms) for the raw connection's exponential backoff between
   * retries. Defaults to 1000.
   */
  rawConnectionBaseDelayMs?: number;

  /**
   * Ceiling (ms) the raw connection's exponential backoff is clamped to.
   * Defaults to 30000.
   */
  rawConnectionMaxDelayMs?: number;
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
