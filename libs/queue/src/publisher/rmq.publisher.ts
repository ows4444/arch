import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type ChannelWrapper } from 'amqp-connection-manager';
import type { Message, Options } from 'amqplib';
import { ClassConstructor } from 'class-transformer';
import { RMQConnection } from '../connection/rmq.connection';
import { RMQPayloadValidator } from '../consumer/rmq-payload-validator';
import { RMQHeaderValidator } from '../context/rmq-header.validator';
import { UnroutableMessageError } from '../errors/unroutable-message.error';
import {
  RMQ_HEADERS,
  RMQ_INTERNAL_PUBLISH_ID_HEADER,
} from '../queue.constants';
import type { RMQQueueRef } from '../queue.types';
import { RMQSerializer } from './serializer';

type PublishTarget = Pick<RMQQueueRef, 'EXCHANGE_NAME' | 'ROUTING_KEY'>;

@Injectable()
export class RMQPublisher {
  private readonly logger = new Logger(RMQPublisher.name);

  private readonly channel: ChannelWrapper;

  // Keyed by a per-call internal publish id (see RMQ_INTERNAL_PUBLISH_ID_HEADER),
  // not the caller-supplied AMQP messageId — retries and outbox redelivery
  // legitimately reuse the same messageId across multiple publish() calls for
  // the same logical message, which would otherwise let one call's `return`
  // event be misattributed to a different, concurrent call sharing that id.
  private readonly returnedPublishIds = new Set<string>();

  constructor(connection: RMQConnection) {
    this.channel = connection.createChannel('publisher');

    this.channel.on('return', (message: Message) => {
      const internalId = message.properties.headers?.[
        RMQ_INTERNAL_PUBLISH_ID_HEADER
      ] as string | undefined;

      if (internalId) {
        this.returnedPublishIds.add(internalId);
      }

      this.logger.error({
        message: 'RabbitMQ message unroutable',
        exchange: message.fields.exchange,
        routingKey: message.fields.routingKey,
        messageId: String(message.properties.messageId),
      });
    });
  }

  async publish<T>(
    target: PublishTarget,
    payload: T,
    params: {
      messageId: string;
      requestId: string;
      correlationId?: string | undefined;
      causationId?: string | undefined;
      retryCount?: number;
      options?: Options.Publish;
      payloadType?: ClassConstructor<T>;
    },
  ): Promise<void> {
    RMQHeaderValidator.validate({
      requestId: params.requestId,
      ...(params.causationId && {
        [RMQ_HEADERS.CAUSATION_ID]: params.causationId,
      }),
      ...(params.correlationId && {
        [RMQ_HEADERS.CORRELATION_ID]: params.correlationId,
      }),
    });

    const validatedPayload = params.payloadType
      ? RMQPayloadValidator.validate(params.payloadType, payload)
      : payload;

    const body = RMQSerializer.serialize(validatedPayload);

    const publishOptions: Options.Publish = params.options ?? {};

    const rawExtraHeaders =
      publishOptions.headers !== null &&
      typeof publishOptions.headers === 'object' &&
      !Array.isArray(publishOptions.headers)
        ? (publishOptions.headers as Record<string, unknown>)
        : undefined;

    const {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      [RMQ_HEADERS.RETRY_COUNT]: _ignoredRetryCount,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      [RMQ_INTERNAL_PUBLISH_ID_HEADER]: _ignoredInternalId,
      ...extraHeaders
    } = rawExtraHeaders ?? {};

    const messageId = params.messageId;
    const internalPublishId = randomUUID();

    await this.channel.publish(target.EXCHANGE_NAME, target.ROUTING_KEY, body, {
      ...publishOptions,

      persistent: true,
      mandatory: true,
      contentType: 'application/json',
      messageId,

      headers: {
        ...extraHeaders,
        [RMQ_HEADERS.REQUEST_ID]: params.requestId,
        ...(params.correlationId && {
          [RMQ_HEADERS.CORRELATION_ID]: params.correlationId,
        }),
        ...(params.causationId && {
          [RMQ_HEADERS.CAUSATION_ID]: params.causationId,
        }),
        ...(params.retryCount !== undefined && {
          [RMQ_HEADERS.RETRY_COUNT]: params.retryCount,
        }),
        [RMQ_INTERNAL_PUBLISH_ID_HEADER]: internalPublishId,
      },
    });

    if (this.returnedPublishIds.delete(internalPublishId)) {
      throw new UnroutableMessageError({
        exchange: target.EXCHANGE_NAME,
        routingKey: target.ROUTING_KEY,
        messageId,
      });
    }
  }
}
