import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { DatabaseRole, InjectRepository } from '@/database';
import { OutboxRepository } from './outbox.repository';
import type { QueueOutboxOptions } from './outbox.types';
import { QueueConfigurationError } from '../errors/queue-configuration.error';
import { QUEUE_OUTBOX_OPTIONS } from '../queue.constants';
import { QueueOutboxEntity } from '../persistence/entities/queue-outbox.entity';

export interface OutboxEnqueueParams {
  exchange: string;
  routingKey: string;
  payload: unknown;
  messageId?: string;
  headers?: {
    requestId?: string;
    correlationId?: string;
    causationId?: string;
  };
}

@Injectable()
export class OutboxService {
  constructor(
    @InjectRepository(OutboxRepository, DatabaseRole.WRITE)
    private readonly outbox: OutboxRepository,

    @Inject(QUEUE_OUTBOX_OPTIONS)
    private readonly options: QueueOutboxOptions | undefined,
  ) {}

  async enqueue(params: OutboxEnqueueParams): Promise<string> {
    if (!this.options) {
      throw new QueueConfigurationError(
        'Cannot enqueue an outbox message: QueueModule was configured without outbox support',
      );
    }

    const messageId = params.messageId ?? randomUUID();

    await this.outbox.insert({
      messageId,
      exchange: params.exchange,
      routingKey: params.routingKey,
      payload: params.payload,
      headers: params.headers ?? null,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    } as QueryDeepPartialEntity<QueueOutboxEntity>);

    return messageId;
  }
}
