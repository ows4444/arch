import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { type ChannelWrapper } from 'amqp-connection-manager';
import type { Channel, ConsumeMessage } from 'amqplib';
import { RMQConnection } from '../connection/rmq.connection';
import { RMQContextFactory } from '../context/rmq-context.factory';
import { HandlerTimeoutError } from '../errors/handler-timeout.error';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { RetryableMessageError } from '../errors/retryable-message.error';
import { classifyPublishError } from '../publisher/rmq-publish-error.utils';
import { RMQPublisher } from '../publisher/rmq.publisher';
import { RMQSerializer } from '../publisher/serializer';
import { RMQ_HEADERS } from '../queue.constants';
import { RMQContext } from '../queue.types';
import { buildRetryQueueName } from '../retry/retry-queue.naming';
import { TopologyBootstrap } from '../topology/topology.bootstrap';
import { MessageSettlement } from './message-settlement';
import {
  RMQHandlerDefinition,
  RMQHandlerRegistry,
} from './rmq-handler.registry';
import { RMQPayloadValidator } from './rmq-payload-validator';
import { getRetryCount } from './rmq-retry.utils';

interface RetryDecision {
  shouldRetry: boolean;
  retryCount: number;
}

interface ActiveConsumer {
  wrapper: ChannelWrapper;
  consumerTag?: string;
}

@Injectable()
export class RMQConsumerRuntime implements OnModuleInit, OnApplicationShutdown {
  private static readonly HANDLER_TIMEOUT_MS = 60_000;

  private static readonly SHUTDOWN_TIMEOUT_MS = 30_000;

  private readonly logger = new Logger(RMQConsumerRuntime.name);

  private readonly consumers: ActiveConsumer[] = [];

  private readonly activeControllers = new Set<AbortController>();

  private inflightCount = 0;

  private shuttingDown = false;

  constructor(
    private readonly connection: RMQConnection,
    private readonly registry: RMQHandlerRegistry,
    private readonly contextFactory: RMQContextFactory,
    private readonly topologyBootstrap: TopologyBootstrap,
    private readonly publisher: RMQPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.topologyBootstrap.waitUntilReady();

    const handlers = this.registry.getHandlers();

    for (const handler of handlers) {
      const consumer: ActiveConsumer = {
        wrapper: this.connection.createChannel(
          `consumer:${handler.options.queue}`,
          async (channel) => {
            consumer.consumerTag = await this.setupConsumer(channel, handler);
          },
        ),
      };

      this.consumers.push(consumer);
    }
  }

  private async setupConsumer(
    channel: Channel,
    handler: RMQHandlerDefinition,
  ): Promise<string> {
    const prefetch = this.connection.resolvePrefetch(handler.options.prefetch);

    await channel.prefetch(prefetch);

    const consumer = await channel.consume(handler.options.queue, (message) => {
      if (!message) {
        this.logger.debug({
          message: 'RabbitMQ consumer cancelled',
          queue: handler.options.queue,
        });

        return;
      }

      if (this.shuttingDown) {
        channel.nack(message, false, true);

        return;
      }

      void this.consumeMessage({ channel, message, handler });
    });

    this.logger.log({
      message: 'RabbitMQ consumer registered',
      queue: handler.options.queue,
      consumerTag: consumer.consumerTag,
      prefetch,
    });

    return consumer.consumerTag;
  }

  private async consumeMessage(params: {
    channel: Channel;
    message: ConsumeMessage;
    handler: RMQHandlerDefinition;
  }): Promise<void> {
    this.incrementInflight();

    const startedAt = Date.now();
    const { channel, message, handler } = params;
    const settlement = new MessageSettlement(channel, message);
    const abortController = new AbortController();

    this.activeControllers.add(abortController);

    const context = this.contextFactory.create({
      message,
      queue: handler.options.queue,
      signal: abortController.signal,
    });

    // payload is intentionally declared outside try so it's accessible in the
    // catch block for retry publishing. If deserialization throws, it remains
    // undefined — publishRetry guards against that and throws QueueConfigurationError.
    let payload: unknown;

    try {
      const rawPayload = RMQSerializer.deserialize(message.content);

      payload = this.validatePayload({ payload: rawPayload, handler });

      await this.executeHandler({
        handler,
        payload,
        context,
        controller: abortController,
      });

      settlement.ack();
    } catch (error: unknown) {
      const err =
        error instanceof Error
          ? error
          : new Error('Unknown RMQ consumer error');

      const retryDecision = this.getRetryDecision({
        error: err,
        handler,
        message,
      });

      this.logger.error({
        message: 'RMQ consumer failed',
        queue: handler.options.queue,
        routingKey: handler.options.routingKey,
        retryCount: retryDecision.retryCount,
        timeout: err instanceof HandlerTimeoutError,
        error: err.message,
        stack: err.stack,
      });

      if (!retryDecision.shouldRetry) {
        settlement.nack(false);

        return;
      }

      try {
        await this.publishRetry({
          handler,
          payload,
          requestId: context.requestId,
          correlationId: context.correlationId,
          causationId: context.causationId,
          message,
          retryCount: retryDecision.retryCount,
        });

        settlement.ack();

        this.logger.debug({
          message: 'RabbitMQ message scheduled for retry',
          queue: handler.options.queue,
          retryCount: retryDecision.retryCount + 1,
        });
      } catch (publishError: unknown) {
        const isRetryQueueFull =
          publishError instanceof Error
            ? classifyPublishError(publishError).rejected
            : false;
        const isConfigError = publishError instanceof QueueConfigurationError;

        this.logger.error({
          message: 'Failed to publish retry message',
          queue: handler.options.queue,
          retryQueueFull: isRetryQueueFull,
          error:
            publishError instanceof Error
              ? publishError.message
              : 'Unknown error',
        });

        // Dead-letter on retry-queue-full (x-overflow: reject-publish) or any
        // configuration error (no retry policy, missing messageId, etc.) — both
        // are permanent conditions that requeuing cannot resolve.
        // Requeue only on transient broker errors (timeout, connection closed)
        // so the message is retried once the broker recovers.
        settlement.nack(!isRetryQueueFull && !isConfigError);
      }
    } finally {
      this.activeControllers.delete(abortController);
      abortController.abort();
      this.decrementInflight();
      this.logSlowHandler({ startedAt, handler });
    }
  }

  private async cancelConsumers(): Promise<void> {
    await Promise.allSettled(
      this.consumers.map(async ({ wrapper, consumerTag }) => {
        if (!consumerTag) {
          return;
        }

        await wrapper.cancel(consumerTag);
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;

    await this.cancelConsumers();

    for (const controller of this.activeControllers) {
      controller.abort();
    }

    await this.waitForInflightMessages();

    await Promise.allSettled(
      this.consumers.map(({ wrapper }) => wrapper.close()),
    );

    this.logger.log({
      message: 'RabbitMQ consumers shutdown complete',
    });
  }

  private logSlowHandler(params: {
    startedAt: number;
    handler: RMQHandlerDefinition;
  }): void {
    const { startedAt, handler } = params;
    const durationMs = Date.now() - startedAt;

    if (durationMs < 5_000) {
      return;
    }

    this.logger.warn({
      message: 'Slow RabbitMQ consumer handler',
      queue: handler.options.queue,
      durationMs,
    });
  }

  private incrementInflight(): void {
    this.inflightCount += 1;
  }

  private decrementInflight(): void {
    if (this.inflightCount === 0) {
      this.logger.debug({
        message: 'RabbitMQ inflight counter underflow prevented',
      });

      return;
    }

    this.inflightCount -= 1;
  }

  private async waitForInflightMessages(): Promise<void> {
    const startedAt = Date.now();

    while (this.inflightCount > 0) {
      if (Date.now() - startedAt >= RMQConsumerRuntime.SHUTDOWN_TIMEOUT_MS) {
        this.logger.warn({
          message: 'Timed out waiting for inflight RabbitMQ messages',
          inflightMessages: this.inflightCount,
        });

        return;
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 100).unref();
      });
    }

    this.logger.log({
      message: 'All inflight RabbitMQ messages drained',
    });
  }

  private async publishRetry(params: {
    handler: RMQHandlerDefinition;
    payload: unknown;
    requestId: string;
    correlationId?: string;
    causationId?: string;
    message: ConsumeMessage;
    retryCount: number;
  }): Promise<void> {
    const {
      handler,
      payload,
      requestId,
      correlationId,
      causationId,
      message,
      retryCount,
    } = params;

    if (payload === undefined) {
      throw new QueueConfigurationError(
        'Cannot retry message with undefined payload',
      );
    }

    const retryPolicy = handler.options.retryPolicy;

    if (!retryPolicy) {
      throw new QueueConfigurationError('Retry policy not configured');
    }

    const delaySeconds = retryPolicy.strategy[retryCount];

    if (delaySeconds === undefined) {
      throw new QueueConfigurationError(
        `Retry strategy missing delay for retry #${retryCount + 1}`,
      );
    }

    const retryQueue = buildRetryQueueName({
      exchange: handler.options.exchange,
      queue: handler.options.queue,
      delaySeconds,
    });

    const { messageId } = message.properties as { messageId?: string };

    if (typeof messageId !== 'string') {
      throw new QueueConfigurationError(
        'Retry publish requires AMQP messageId',
      );
    }

    await this.publisher.publish(
      {
        EXCHANGE_NAME: '',
        ROUTING_KEY: retryQueue,
      },
      payload,
      {
        messageId,
        requestId,
        correlationId,
        causationId,
        options: {
          headers: {
            ...(message.properties.headers ?? {}),
            [RMQ_HEADERS.RETRY_COUNT]: retryCount + 1,
          },
        },
      },
    );
  }

  private getRetryDecision(params: {
    error: Error;
    handler: RMQHandlerDefinition;
    message: ConsumeMessage;
  }): RetryDecision {
    const { error, handler, message } = params;

    const retryCount = getRetryCount(message);
    const retryPolicy = handler.options.retryPolicy;

    if (!retryPolicy) {
      return { shouldRetry: false, retryCount };
    }

    const maxRetries = retryPolicy.strategy.length;
    const shouldRetry =
      error instanceof RetryableMessageError && retryCount < maxRetries;

    return { shouldRetry, retryCount };
  }

  private async executeHandler(params: {
    handler: RMQHandlerDefinition;
    payload: unknown;
    context: RMQContext;
    controller: AbortController;
  }): Promise<void> {
    const { handler, payload, context, controller } = params;

    const handlerPromise = Promise.resolve().then(() =>
      handler.invoke(payload, context),
    );

    await this.withTimeout({ promise: handlerPromise, controller });
  }

  private validatePayload(params: {
    payload: unknown;
    handler: RMQHandlerDefinition;
  }): unknown {
    const { payload, handler } = params;
    const payloadType = handler.options.payloadType;

    if (!payloadType) {
      return payload;
    }

    return RMQPayloadValidator.validate(payloadType, payload);
  }

  private async withTimeout<T>(params: {
    promise: Promise<T>;
    controller: AbortController;
  }): Promise<T> {
    const { promise, controller } = params;

    void promise.catch(() => undefined);

    let timeout!: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new HandlerTimeoutError(RMQConsumerRuntime.HANDLER_TIMEOUT_MS));
      }, RMQConsumerRuntime.HANDLER_TIMEOUT_MS).unref();
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
