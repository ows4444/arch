import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { DatabaseRole, InjectRepository } from '@/database';
import { OutboxRepository } from './outbox.repository';
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
  ) {}

  async enqueue(params: OutboxEnqueueParams): Promise<string> {
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
