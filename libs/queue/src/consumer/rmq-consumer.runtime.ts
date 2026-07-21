import {
  Inject,
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
import { UnroutableMessageError } from '../errors/unroutable-message.error';
import { QUEUE_INBOX_SERVICE } from '../queue.constants';
import type { QueueInboxService } from '../inbox/queue-inbox.service';
import { classifyPublishError } from '../publisher/rmq-publish-error.utils';
import { RMQPublisher } from '../publisher/rmq.publisher';
import { RMQSerializer } from '../publisher/serializer';
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

    @Inject(QUEUE_INBOX_SERVICE)
    private readonly inbox: QueueInboxService,
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

    let context: RMQContext | undefined;
    let payload: unknown;

    let outcome: 'handled' | 'retry-scheduled' | undefined;
    let retryCountForLog = 0;

    let handlerSettled: Promise<void> = Promise.resolve();

    try {
      context = this.contextFactory.create({
        message,
        queue: handler.options.queue,
        signal: abortController.signal,
      });

      const rawPayload = RMQSerializer.deserialize(message.content);

      payload = this.validatePayload({ payload: rawPayload, handler });

      const handlerPromise = this.invokeHandler({ handler, payload, context });

      handlerSettled = handlerPromise.then(
        () => undefined,
        () => undefined,
      );

      await this.withTimeout({
        promise: handlerPromise,
        controller: abortController,
        timeoutMs:
          handler.options.timeoutMs ?? RMQConsumerRuntime.HANDLER_TIMEOUT_MS,
      });

      outcome = 'handled';
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

      if (!retryDecision.shouldRetry || !context) {
        this.safeNack(settlement, {
          queue: handler.options.queue,
          requeue: false,
        });

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

        outcome = 'retry-scheduled';
        retryCountForLog = retryDecision.retryCount + 1;
      } catch (publishError: unknown) {
        const isRetryQueueFull =
          publishError instanceof Error
            ? classifyPublishError(publishError).rejected
            : false;
        const isConfigError = publishError instanceof QueueConfigurationError;
        // The retry queue itself doesn't exist / can't be routed to (a
        // topology/config mismatch between the decorator's retryPolicy and
        // what TopologyBootstrap declared). Requeuing would redeliver
        // immediately, hit the same unroutable retry-publish again, and
        // loop indefinitely with no backoff — same "won't self-heal" class
        // of failure as isConfigError/isRetryQueueFull, so it must not
        // requeue either.
        const isUnroutable = publishError instanceof UnroutableMessageError;

        this.logger.error({
          message: 'Failed to publish retry message',
          queue: handler.options.queue,
          retryQueueFull: isRetryQueueFull,
          retryQueueUnroutable: isUnroutable,
          error:
            publishError instanceof Error
              ? publishError.message
              : 'Unknown error',
        });

        this.safeNack(settlement, {
          queue: handler.options.queue,
          requeue: !isRetryQueueFull && !isConfigError && !isUnroutable,
        });

        return;
      }
    } finally {
      this.activeControllers.delete(abortController);
      abortController.abort();
      this.logSlowHandler({ startedAt, handler });

      void handlerSettled.finally(() => this.decrementInflight());
    }

    this.safeAck(settlement, { queue: handler.options.queue });

    if (outcome === 'retry-scheduled') {
      this.logger.debug({
        message: 'RabbitMQ message scheduled for retry',
        queue: handler.options.queue,
        retryCount: retryCountForLog,
      });
    }
  }

  private safeAck(
    settlement: MessageSettlement,
    context: { queue: string },
  ): void {
    try {
      settlement.ack();
    } catch (error: unknown) {
      this.logger.error({
        message:
          'RMQ ack failed; the message was already processed successfully ' +
          'and will be redelivered by the broker once the channel/connection ' +
          'recovers, rather than retried via the application retry policy',
        queue: context.queue,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private safeNack(
    settlement: MessageSettlement,
    context: { queue: string; requeue: boolean },
  ): void {
    try {
      settlement.nack(context.requeue);
    } catch (error: unknown) {
      this.logger.error({
        message:
          'RMQ nack failed; the broker will redeliver the message once the ' +
          'channel/connection recovers',
        queue: context.queue,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
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

    // Close the shared connection only after every consumer has been
    // cancelled and drained — Nest doesn't order OnApplicationShutdown hooks
    // across sibling providers (they all fire concurrently), so closing it
    // here (rather than from RMQConnection's own shutdown hook) is what
    // guarantees in-flight ack/nack calls above complete on a live channel.
    await this.connection.close();

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
    correlationId?: string | undefined;
    causationId?: string | undefined;
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
        retryCount: retryCount + 1,
        options: {
          headers: {
            ...(message.properties.headers ?? {}),
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

  private invokeHandler(params: {
    handler: RMQHandlerDefinition;
    payload: unknown;
    context: RMQContext;
  }): Promise<void> {
    const { handler, payload, context } = params;

    const invoke = () => Promise.resolve(handler.invoke(payload, context));

    if (!context.messageId) {
      this.logger.warn({
        message:
          'RMQ message has no messageId; consuming without inbox idempotency protection',
        queue: handler.options.queue,
      });

      return Promise.resolve().then(invoke);
    }

    return this.inbox
      .withIdempotency(handler.options.queue, context.messageId, invoke)
      .then((ran) => {
        if (ran) {
          return;
        }

        this.logger.debug({
          message: 'RMQ message already processed; skipped as duplicate',
          queue: handler.options.queue,
          messageId: context.messageId,
        });
      });
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
    timeoutMs: number;
  }): Promise<T> {
    const { promise, controller, timeoutMs } = params;

    void promise.catch(() => undefined);

    let timeout!: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new HandlerTimeoutError(timeoutMs));
      }, timeoutMs).unref();
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timeout);
    }
  }
}
