import { Injectable, Logger } from '@nestjs/common';
import { type ChannelWrapper } from 'amqp-connection-manager';
import type { Message, Options } from 'amqplib';
import { ClassConstructor } from 'class-transformer';
import { RMQConnection } from '../connection/rmq.connection';
import { RMQPayloadValidator } from '../consumer/rmq-payload-validator';
import { RMQHeaderValidator } from '../context/rmq-header.validator';
import { RMQ_HEADERS } from '../queue.constants';
import { RMQSerializer } from './serializer';

interface PublishTarget {
  EXCHANGE_NAME: string;
  ROUTING_KEY: string;
}

@Injectable()
export class RMQPublisher {
  private readonly logger = new Logger(RMQPublisher.name);

  private readonly channel: ChannelWrapper;

  constructor(connection: RMQConnection) {
    this.channel = connection.createChannel('publisher');

    this.channel.on('return', (message: Message) => {
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
      correlationId?: string;
      causationId?: string;
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

    const extraHeaders =
      publishOptions.headers !== null &&
      typeof publishOptions.headers === 'object' &&
      !Array.isArray(publishOptions.headers)
        ? (publishOptions.headers as Record<string, unknown>)
        : undefined;

    const messageId = params.messageId;

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
      },
    });
  }
}
