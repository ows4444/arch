import { Injectable } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';
import type { RMQContext } from '../queue.types';
import { RMQHeaderParser } from './rmq-header.parser';

@Injectable()
export class RMQContextFactory {
  create(params: {
    message: ConsumeMessage;
    queue: string;
    signal: AbortSignal;
  }): RMQContext {
    const { message, queue } = params;

    const rawHeaders = (message.properties.headers ?? {}) as Record<
      string,
      unknown
    >;

    const headers = RMQHeaderParser.parse(rawHeaders);

    const result: RMQContext = {
      messageId:
        typeof message.properties.messageId === 'string'
          ? message.properties.messageId
          : undefined,

      requestId: headers.requestId,
      correlationId: headers.correlationId,
      causationId: headers.causationId,
      routingKey: message.fields.routingKey,
      exchange: message.fields.exchange,
      queue,
      receivedAt: Date.now(),
      signal: params.signal,
    };
    return result;
  }
}
